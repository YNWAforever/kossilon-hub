import type { AuthenticatedActor } from "@/features/auth/types";
import type { WhatsAppIntakeRepository, IntakeInput } from "./intake-repository";
import type { MediaDownloadResult } from "./media-download";

/** Download is a bounded read; publish revalidates the locked mapping and actor. */
export function createWhatsAppMediaIntakeService(dependencies: {
  repository: WhatsAppIntakeRepository;
  download(fileId: string): Promise<MediaDownloadResult>;
}) {
  return {
    async ingest(actor: AuthenticatedActor, input: IntakeInput) {
      const preview = await dependencies.repository.mediaPreview(actor, input);
      if (preview.received) return preview.received;
      const downloaded = await dependencies.download(preview.media.provider_media_id);
      if (downloaded.status !== "downloaded") return downloaded;
      const prepared = await dependencies.repository.prepare(actor, input, downloaded);
      if (prepared.received) return prepared.received;
      return dependencies.repository.finish(actor, input, prepared.intentId!, downloaded.body);
    },
  };
}
