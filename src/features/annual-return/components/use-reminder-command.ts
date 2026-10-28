import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  annualReturnReminderCommandStorageKey,
  annualReturnReminderLatestStorageKey,
  manualReminderReceiptCopy,
  persistAnnualReturnReminderCommand,
  persistLatestAnnualReturnReminderCommand,
  readLatestAnnualReturnReminderCommand,
  readStoredAnnualReturnReminderCommand,
  type AnnualReturnReminderCommandSnapshot,
  type ManualReminderCommandReceipt,
} from "../reminder-command";
import { readAnnualReturnReminderCommand } from "../server-fns";

type SendReminder = (input: {
  recipientName: string;
  recipientPhone: string;
  commandUuid: string;
}) => Promise<unknown>;

type ReminderStorage = Pick<Storage, "getItem" | "setItem">;

function storedRecipientCommand(
  storage: ReminderStorage,
  snapshot: AnnualReturnReminderCommandSnapshot,
): string | null {
  const latest = readLatestAnnualReturnReminderCommand(
    storage,
    annualReturnReminderLatestStorageKey(snapshot),
  );
  // Keep the latest command across phone formatting edits, including when an
  // older spelling still has a closed receipt cached. Preserve existing keys.
  if (
    latest &&
    latest.recipientName === snapshot.recipientName.trim() &&
    latest.recipientPhone.replace(/\D/g, "") === snapshot.recipientPhone.replace(/\D/g, "")
  ) {
    return latest.commandUuid;
  }
  return readStoredAnnualReturnReminderCommand(
    storage,
    annualReturnReminderCommandStorageKey(snapshot),
  );
}

function reminderCommandQueryKey(caseId: string, commandUuid: string) {
  return ["annual-return-reminder-command", caseId, commandUuid] as const;
}

function receiptMessage(receipt: ManualReminderCommandReceipt | undefined): string | null {
  if (!receipt) return null;
  const copy = manualReminderReceiptCopy(receipt);
  if (!("messageId" in receipt) || !receipt.messageId) return copy;
  return `${copy} 訊息 ID：${receipt.messageId}`;
}

export function useAnnualReturnReminderCommand({
  caseId,
  actorScope,
  locked,
  sendReminder,
  onQueued,
  storage = () => sessionStorage,
}: {
  caseId: string;
  actorScope: string;
  locked: boolean;
  sendReminder: SendReminder;
  onQueued?: () => void;
  storage?: () => ReminderStorage;
}) {
  const queryClient = useQueryClient();
  const sendRef = useRef(sendReminder);
  sendRef.current = sendReminder;
  const onQueuedRef = useRef(onQueued);
  onQueuedRef.current = onQueued;
  const storageRef = useRef(storage);
  storageRef.current = storage;
  const mounted = useRef(true);
  const posting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [commandUuid, setCommandUuid] = useState<string | null>(null);
  const [watch, setWatch] = useState(false);
  const [postingState, setPostingState] = useState(false);
  const [failedReadCommand, setFailedReadCommand] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [journalError, setJournalError] = useState<string | null>(null);

  useEffect(() => {
    let latest: ReturnType<typeof readLatestAnnualReturnReminderCommand>;
    try {
      latest = readLatestAnnualReturnReminderCommand(
        storageRef.current(),
        annualReturnReminderLatestStorageKey({ actorScope, caseId }),
      );
      setJournalError(null);
    } catch (error) {
      setJournalError(error instanceof Error ? error.message : "無法讀取提醒指令紀錄。");
      return;
    }
    if (!latest) return;
    setRecipientName(latest.recipientName);
    setRecipientPhone(latest.recipientPhone);
  }, [actorScope, caseId]);

  useEffect(() => {
    if (posting.current) return;
    const name = recipientName.trim();
    const phone = recipientPhone.trim();
    if (!name || phone.length < 3) {
      setCommandUuid(null);
      setWatch(false);
      return;
    }
    try {
      const stored = storedRecipientCommand(storageRef.current(), {
        actorScope,
        caseId,
        recipientName: name,
        recipientPhone: phone,
      });
      setJournalError(null);
      setCommandUuid(stored);
      setWatch(Boolean(stored));
    } catch (error) {
      setJournalError(error instanceof Error ? error.message : "無法讀取提醒指令紀錄。");
      setWatch(false);
    }
    // Recipient edits during a POST are deferred until its receipt read ends.
    // Rebind then so that receipt cannot close another recipient's command.
  }, [actorScope, caseId, recipientName, recipientPhone, postingState]);

  const commandQuery = useQuery({
    queryKey: reminderCommandQueryKey(caseId, commandUuid ?? "none"),
    enabled: watch && Boolean(commandUuid),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: () =>
      readAnnualReturnReminderCommand({
        data: { caseId, commandUuid: commandUuid! },
      }),
  });

  const mutation = useMutation({
    retry: false,
    mutationFn: (input: { recipientName: string; recipientPhone: string; commandUuid: string }) =>
      sendRef.current(input),
    onSuccess: () => {
      onQueuedRef.current?.();
    },
    onSettled: async (_data, _error, variables) => {
      if (!variables) {
        posting.current = false;
        if (mounted.current) setPostingState(false);
        return;
      }
      try {
        const receipt = await readAnnualReturnReminderCommand({
          data: { caseId, commandUuid: variables.commandUuid },
        });
        queryClient.setQueryData(reminderCommandQueryKey(caseId, variables.commandUuid), receipt);
        if (!mounted.current) return;
        setFailedReadCommand(null);
        setWatch(true);
      } catch {
        if (mounted.current) setFailedReadCommand(variables.commandUuid);
      } finally {
        posting.current = false;
        if (mounted.current) setPostingState(false);
      }
    },
  });

  const receipt = commandQuery.data;
  const closed = Boolean(receipt && receipt.state !== "absent");
  const readBlocked =
    (commandUuid !== null && failedReadCommand === commandUuid) || commandQuery.isError;
  const pending =
    postingState || mutation.isPending || reconciling || (watch && commandQuery.isFetching);
  const sendDisabled =
    locked ||
    pending ||
    readBlocked ||
    Boolean(journalError) ||
    !recipientName.trim() ||
    recipientPhone.trim().length < 3;

  function send() {
    if (posting.current || mutation.isPending || sendDisabled) return;
    const name = recipientName.trim();
    const phone = recipientPhone.trim();
    const snapshot = { actorScope, caseId, recipientName: name, recipientPhone: phone };
    const key = annualReturnReminderCommandStorageKey(snapshot);
    let nextCommand: string;
    try {
      const stored = storedRecipientCommand(storageRef.current(), snapshot);
      nextCommand = !stored || closed ? crypto.randomUUID() : stored;
      persistAnnualReturnReminderCommand(storageRef.current(), key, nextCommand);
      persistLatestAnnualReturnReminderCommand(
        storageRef.current(),
        annualReturnReminderLatestStorageKey({ actorScope, caseId }),
        { recipientName: name, recipientPhone: phone, commandUuid: nextCommand },
      );
      setJournalError(null);
    } catch (error) {
      setJournalError(error instanceof Error ? error.message : "無法保存提醒指令紀錄。");
      return;
    }
    posting.current = true;
    setPostingState(true);
    setWatch(false);
    setFailedReadCommand(null);
    setCommandUuid(nextCommand);
    mutation.mutate({ recipientName: name, recipientPhone: phone, commandUuid: nextCommand });
  }

  async function reconcile() {
    if (!commandUuid || posting.current) return;
    setReconciling(true);
    setFailedReadCommand(null);
    try {
      const next = await readAnnualReturnReminderCommand({
        data: { caseId, commandUuid },
      });
      queryClient.setQueryData(reminderCommandQueryKey(caseId, commandUuid), next);
      if (!mounted.current) return;
      setWatch(true);
    } catch {
      if (mounted.current) setFailedReadCommand(commandUuid);
    } finally {
      if (mounted.current) setReconciling(false);
    }
  }

  const statusMessage = journalError
    ? journalError
    : readBlocked
      ? "未能核對提醒結果。請先重試核對，不要再按發送。"
      : postingState && !mutation.isPending
        ? "正在核對提醒結果。"
        : receiptMessage(receipt);

  return {
    recipientName,
    setRecipientName,
    recipientPhone,
    setRecipientPhone,
    send,
    reconcile,
    pending,
    sendDisabled,
    showReconcile: readBlocked && Boolean(commandUuid),
    reconciling,
    statusMessage,
    showMutationError: mutation.isError && (!receipt || receipt.state === "absent"),
    error: mutation.error instanceof Error ? mutation.error : null,
  };
}
