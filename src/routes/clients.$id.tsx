import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { useAuth } from "@/features/auth/auth-context-neon";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ContactFormDialog } from "@/components/clients/contact-form-dialog";
import { ProductionClientProfile } from "@/features/clients/components/production-client-profile";
import { removeClientContact } from "@/features/clients/server-fns";
import type { ClientDetail, CompanyContact } from "@/features/clients/types";

export const Route = createFileRoute("/clients/$id")({
  component: ClientProfileRoute,
});

function ClientProfileRoute() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ClientDetail | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<CompanyContact | undefined>(undefined);
  const [removingContactId, setRemovingContactId] = useState<string | null>(null);

  const canManage = session?.role === "Admin" || session?.role === "Manager";
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["clients"] });

  async function handleRemoveContact(contact: CompanyContact) {
    setRemovingContactId(contact.id);

    try {
      await removeClientContact({ data: { companyId: id, contactId: contact.id } });
      toast.success("Contact removed.");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove the contact.");
    } finally {
      setRemovingContactId(null);
    }
  }

  return (
    <>
      <ProductionClientProfile
        clientId={id}
        onEditClient={setEditing}
        onAddContact={() => {
          setEditingContact(undefined);
          setContactOpen(true);
        }}
        onEditContact={(contact) => {
          setEditingContact(contact);
          setContactOpen(true);
        }}
        onRemoveContact={(contact) => void handleRemoveContact(contact)}
        removingContactId={removingContactId}
      />

      <ClientFormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        client={editing ?? undefined}
        canManage={canManage}
        onSaved={refresh}
      />

      <ContactFormDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        companyId={id}
        contact={editingContact}
        onSaved={refresh}
      />
    </>
  );
}
