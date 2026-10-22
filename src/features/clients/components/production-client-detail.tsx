import { Button } from "@/components/ui/button";
import { RecordUnavailable } from "@/components/record-unavailable";
import { LoadingRows } from "@/components/ui/skeleton";
import { parseEntityId } from "@/lib/entity-id";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { type ReactNode, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import type { StatusTone } from "@/lib/status";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ContactFormDialog } from "@/components/clients/contact-form-dialog";
import { OfficerFormDialog } from "@/components/clients/officer-form-dialog";
import { ShareholdingFormDialog } from "@/components/clients/shareholding-form-dialog";
import { ControllerFormDialog } from "@/components/clients/controller-form-dialog";
import { InspectionRequestFormDialog } from "@/components/clients/inspection-request-form-dialog";
import { ResolveInspectionRequestDialog } from "@/components/clients/resolve-inspection-request-dialog";
import { DeadlinePill } from "@/components/deadline-pill";
import { ServiceSubscriptionsSection } from "./service-subscriptions-section";
import { ClientDocuments, ClientWorkOverview } from "./client-work-overview";
import { clientDetailSearch } from "../register-view-state";
import { clientCaseReturnPath } from "../client-return-context";
import {
  ceaseClientController,
  ceaseClientOfficer,
  ceaseClientShareholding,
  getClient,
  listClientAssignmentOptions,
  removeClientContact,
} from "../server-fns";
import type {
  ClientPaymentStatus,
  CompanyContact,
  CompanyStatus,
  SignificantController,
} from "../types";
import {
  COMPANY_STATUS_LABELS,
  CONTROL_BASIS_LABELS,
  OFFICER_TYPE_LABELS,
  PAYMENT_STATUS_LABELS,
} from "../labels";

const companyStatusTone: Record<CompanyStatus, StatusTone> = {
  active: "green",
  inactive: "neutral",
};

const paymentStatusTone: Record<ClientPaymentStatus, StatusTone> = {
  "Not invoiced": "neutral",
  "Payment pending": "yellow",
  "Payment received": "green",
  Overdue: "red",
};

const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find((candidate) => candidate.type === type);

  if (!part) {
    throw new Error(`Unable to derive ${type} from Hong Kong business date.`);
  }

  return part.value;
}

function today(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  return `${datePart(parts, "year")}-${datePart(parts, "month")}-${datePart(parts, "day")}`;
}

export function ProductionClientDetail({
  clientId,
  actorScope,
  returnTo,
}: {
  clientId: string;
  actorScope?: unknown;
  returnTo?: string;
}) {
  // A malformed link can never name a client; asking the server only fails
  // its schema validation, which used to read as a temporary outage.
  const safeReturnTo = clientDetailSearch({ returnTo }).returnTo;
  if (parseEntityId(clientId) === null) return <ClientNotFound returnTo={safeReturnTo} />;
  return <ClientDetail clientId={clientId} actorScope={actorScope} returnTo={safeReturnTo} />;
}

function ClientNotFound({ returnTo }: { returnTo: string }) {
  return <RecordUnavailable title="找不到客戶" back={<a href={returnTo}>返回客戶</a>} />;
}

function ClientDetail({
  clientId,
  actorScope,
  returnTo,
}: {
  clientId: string;
  actorScope?: unknown;
  returnTo: string;
}) {
  const queryClient = useQueryClient();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [contactDialog, setContactDialog] = useState<{ open: boolean; contact?: CompanyContact }>({
    open: false,
  });
  const [removingContactId, setRemovingContactId] = useState<string | null>(null);
  const [isOfficerDialogOpen, setIsOfficerDialogOpen] = useState(false);
  const [isShareholdingDialogOpen, setIsShareholdingDialogOpen] = useState(false);
  const [ceasingOfficerId, setCeasingOfficerId] = useState<string | null>(null);
  const [ceasingShareholdingId, setCeasingShareholdingId] = useState<string | null>(null);
  const [controllerDialog, setControllerDialog] = useState<{
    open: boolean;
    controller?: SignificantController;
  }>({ open: false });
  const [ceasingControllerId, setCeasingControllerId] = useState<string | null>(null);
  const [isInspectionDialogOpen, setIsInspectionDialogOpen] = useState(false);
  const [resolvingInspectionRequestId, setResolvingInspectionRequestId] = useState<string | null>(
    null,
  );

  const clientQuery = useQuery({
    queryKey: ["clients", clientId],
    queryFn: () => getClient({ data: { id: clientId } }),
    retry: false,
  });

  const optionsQuery = useQuery({
    queryKey: ["clients", "assignment-options"],
    queryFn: () => listClientAssignmentOptions(),
    retry: false,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["clients", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
  }

  async function handleRemoveContact(contactId: string) {
    setRemovingContactId(contactId);

    try {
      await removeClientContact({ data: { companyId: clientId, contactId } });
      invalidate();
    } catch {
      toast.error("未能移除聯絡人，請再試一次。");
    } finally {
      setRemovingContactId(null);
    }
  }

  async function handleCeaseOfficer(officerId: string) {
    setCeasingOfficerId(officerId);

    try {
      await ceaseClientOfficer({
        data: {
          companyId: clientId,
          officerId,
          cessationDate: today(),
        },
      });
      invalidate();
    } catch {
      toast.error("未能終止該高級人員的任職，請再試一次。");
    } finally {
      setCeasingOfficerId(null);
    }
  }

  async function handleCeaseShareholding(shareholdingId: string) {
    setCeasingShareholdingId(shareholdingId);

    try {
      await ceaseClientShareholding({
        data: {
          companyId: clientId,
          shareholdingId,
          cessationDate: today(),
        },
      });
      invalidate();
    } catch {
      toast.error("未能終止該股權，請再試一次。");
    } finally {
      setCeasingShareholdingId(null);
    }
  }

  async function handleCeaseController(controllerId: string) {
    setCeasingControllerId(controllerId);

    try {
      await ceaseClientController({
        data: {
          companyId: clientId,
          controllerId,
          cessationDate: today(),
        },
      });
      invalidate();
    } catch {
      toast.error("未能終止該重要控制人，請再試一次。");
    } finally {
      setCeasingControllerId(null);
    }
  }

  if (clientQuery.isPending) {
    return <LoadingRows label="載入客戶資料中" rows={6} className="p-6" />;
  }

  if (clientQuery.isError) {
    return (
      <RecordUnavailable
        title="客戶資料無法載入"
        message="客戶資料暫時無法載入，請稍後再試。"
        back={<a href={returnTo}>返回客戶</a>}
        onRetry={() => void clientQuery.refetch()}
      />
    );
  }

  const client = clientQuery.data;

  if (!client) return <ClientNotFound returnTo={returnTo} />;

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="案件與客戶"
        title={client.companyName}
        subtitle={`CR ${client.crNumber} · BR ${client.brNumber}`}
        actions={
          <>
            <Button asChild>
              <a href={returnTo}>返回客戶清單</a>
            </Button>
            {optionsQuery.data ? (
              <Button onClick={() => setIsEditOpen(true)}>編輯客戶</Button>
            ) : null}
          </>
        }
      />

      <ClientWorkOverview companyId={clientId} actorScope={actorScope} returnTo={returnTo} />

      {optionsQuery.isError ? (
        <p role="status" className="text-sm text-status-yellow-text">
          負責同事及團隊選項暫時無法載入，載入前未能編輯客戶。
        </p>
      ) : null}

      <section className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-3">
        <Detail
          label="狀態"
          value={
            <StatusPill tone={companyStatusTone[client.status]}>
              {COMPANY_STATUS_LABELS[client.status]}
            </StatusPill>
          }
        />
        <Detail label="負責同事" value={client.ownerName} />
        <Detail label="團隊" value={client.teamName} />
        <Detail label="成立日期" value={client.incorporationDate} />
        <Detail label="周年申報基準日" value={client.annualReturnBasisDate} />
        <Detail label="註冊辦事處" value={client.registeredOffice} />
        <Detail label="公司秘書" value={client.companySecretary} />
        <Detail
          label="最近付款"
          value={
            client.paymentStatus ? (
              <StatusPill tone={paymentStatusTone[client.paymentStatus]}>
                {PAYMENT_STATUS_LABELS[client.paymentStatus]}
              </StatusPill>
            ) : (
              "尚未有案件"
            )
          }
        />
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">高級人員</h2>
          <Button size="sm" onClick={() => setIsOfficerDialogOpen(true)}>
            委任高級人員
          </Button>
        </div>
        <div className="divide-y">
          {client.officers.map((officer) => (
            <div key={officer.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {officer.name}
                  <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                    {OFFICER_TYPE_LABELS[officer.officerType]}
                  </span>
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  委任日期 {formatDate(officer.appointmentDate)}
                  {officer.cessationDate ? ` · 終止日期 ${formatDate(officer.cessationDate)}` : ""}
                  {officer.identificationNumber ? ` · ${officer.identificationNumber}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill tone={officer.cessationDate ? "neutral" : "green"}>
                  {officer.cessationDate ? "已終止" : "在任"}
                </StatusPill>
                {!officer.cessationDate ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleCeaseOfficer(officer.id)}
                    disabled={ceasingOfficerId === officer.id}
                  >
                    終止
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          {client.officers.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">未有高級人員紀錄。</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">股東</h2>
          <Button size="sm" onClick={() => setIsShareholdingDialogOpen(true)}>
            記錄股權
          </Button>
        </div>
        <div className="divide-y">
          {client.shareholdings.map((shareholding) => (
            <div key={shareholding.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{shareholding.shareholderName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {shareholding.numberOfShares} 股（{shareholding.shareClass}）· 配發日期{" "}
                  {formatDate(shareholding.allotmentDate)}
                  {shareholding.cessationDate
                    ? ` · 終止日期 ${formatDate(shareholding.cessationDate)}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill tone={shareholding.cessationDate ? "neutral" : "green"}>
                  {shareholding.cessationDate ? "已終止" : "有效"}
                </StatusPill>
                {!shareholding.cessationDate ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleCeaseShareholding(shareholding.id)}
                    disabled={ceasingShareholdingId === shareholding.id}
                  >
                    終止
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          {client.shareholdings.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">未有股權紀錄。</p>
          ) : null}
        </div>
      </section>

      <ServiceSubscriptionsSection companyId={client.id} />

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">重要控制人</h2>
          <Button size="sm" onClick={() => setControllerDialog({ open: true })}>
            記錄重要控制人
          </Button>
        </div>
        <div className="divide-y">
          {client.significantControllers.map((controller) => (
            <div key={controller.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{controller.controllerName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  登記日期 {formatDate(controller.registeredDate)}
                  {controller.cessationDate
                    ? ` · 終止日期 ${formatDate(controller.cessationDate)}`
                    : ""}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {controller.controlBases.map((basis) => (
                    <span
                      key={basis}
                      className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground"
                    >
                      {CONTROL_BASIS_LABELS[basis] ?? basis.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {controller.registerUpdateDueDate ? (
                  <DeadlinePill dueDate={controller.registerUpdateDueDate} />
                ) : null}
                <StatusPill tone={controller.cessationDate ? "neutral" : "green"}>
                  {controller.cessationDate ? "已終止" : "有效"}
                </StatusPill>
                {!controller.cessationDate ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() => setControllerDialog({ open: true, controller })}
                    >
                      編輯資料
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleCeaseController(controller.id)}
                      disabled={ceasingControllerId === controller.id}
                    >
                      終止
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
          {client.significantControllers.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">未有重要控制人紀錄。</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">查閱要求</h2>
          <Button size="sm" onClick={() => setIsInspectionDialogOpen(true)}>
            記錄查閱要求
          </Button>
        </div>
        <div className="divide-y">
          {client.inspectionRequests.map((request) => (
            <div key={request.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{request.requesterName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {request.requesterAuthority} · 要求日期 {formatDate(request.requestDate)}
                  {request.resolutionNote ? ` · ${request.resolutionNote}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusPill tone={request.resolvedAt ? "green" : "yellow"}>
                  {request.resolvedAt ? "已處理" : "待處理"}
                </StatusPill>
                {!request.resolvedAt ? (
                  <Button size="sm" onClick={() => setResolvingInspectionRequestId(request.id)}>
                    處理
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          {client.inspectionRequests.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">未有查閱要求紀錄。</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">聯絡人</h2>
          <Button size="sm" onClick={() => setContactDialog({ open: true })}>
            新增聯絡人
          </Button>
        </div>
        <div className="divide-y">
          {client.contacts.map((contact) => (
            <div key={contact.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {contact.name}
                  {contact.isPrimary ? (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                      主要
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {contact.role} · {contact.email ?? contact.phone ?? "未有聯絡資料"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => setContactDialog({ open: true, contact })}>
                  編輯
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleRemoveContact(contact.id)}
                  disabled={removingContactId === contact.id}
                >
                  移除
                </Button>
              </div>
            </div>
          ))}
          {client.contacts.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">未有聯絡人紀錄。</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">周年申報紀錄</h2>
        <div className="divide-y">
          {client.annualReturnHistory.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <span>申報年度 {entry.returnYear}</span>
              <span className="text-muted-foreground">結算日 {formatDate(entry.madeUpDate)}</span>
              <span className="text-muted-foreground">
                到期日 {formatDate(entry.filingDueDate)}
              </span>
              <span>{entry.currentStatus}</span>
              <Button asChild size="sm">
                <Link
                  to="/annual-returns/$id"
                  params={{ id: entry.id }}
                  search={{ returnTo: clientCaseReturnPath(clientId, returnTo) }}
                >
                  開啟案件
                </Link>
              </Button>
            </div>
          ))}
          {client.annualReturnHistory.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">尚未有周年申報案件。</p>
          ) : null}
        </div>
      </section>

      <ClientDocuments companyId={clientId} actorScope={actorScope} returnTo={returnTo} />

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">時間線</h2>
        <div className="divide-y">
          {client.timeline.map((entry) => (
            <div key={entry.id} className="py-3 text-sm">
              <p>{entry.description}</p>
              <p className="text-xs text-muted-foreground">
                {entry.actorName ?? "系統"} · {formatDateTime(entry.createdAt)}
              </p>
            </div>
          ))}
          {client.timeline.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">尚未有活動。</p>
          ) : null}
        </div>
      </section>

      {optionsQuery.data ? (
        <ClientFormDialog
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
          options={optionsQuery.data}
          client={client}
          onSaved={invalidate}
        />
      ) : null}

      <ContactFormDialog
        open={contactDialog.open}
        onOpenChange={(open) => setContactDialog((current) => ({ ...current, open }))}
        companyId={clientId}
        contact={contactDialog.contact}
        onSaved={() => {
          invalidate();
          setContactDialog({ open: false });
        }}
      />

      <OfficerFormDialog
        open={isOfficerDialogOpen}
        onOpenChange={setIsOfficerDialogOpen}
        companyId={clientId}
        onSaved={invalidate}
      />

      <ShareholdingFormDialog
        open={isShareholdingDialogOpen}
        onOpenChange={setIsShareholdingDialogOpen}
        companyId={clientId}
        onSaved={invalidate}
      />

      <ControllerFormDialog
        open={controllerDialog.open}
        onOpenChange={(open) => setControllerDialog((current) => ({ ...current, open }))}
        companyId={clientId}
        controller={controllerDialog.controller}
        onSaved={() => {
          invalidate();
          setControllerDialog({ open: false });
        }}
      />

      <InspectionRequestFormDialog
        open={isInspectionDialogOpen}
        onOpenChange={setIsInspectionDialogOpen}
        companyId={clientId}
        onSaved={invalidate}
      />

      {resolvingInspectionRequestId ? (
        <ResolveInspectionRequestDialog
          open
          onOpenChange={(open) => {
            if (!open) setResolvingInspectionRequestId(null);
          }}
          companyId={clientId}
          inspectionRequestId={resolvingInspectionRequestId}
          onSaved={() => {
            invalidate();
            setResolvingInspectionRequestId(null);
          }}
        />
      ) : null}
    </main>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}
