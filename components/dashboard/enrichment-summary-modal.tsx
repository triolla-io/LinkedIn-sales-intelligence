// components/dashboard/enrichment-summary-modal.tsx
"use client";

import { useEffect, useState } from "react";
import {
  Modal,
  ModalBackdrop,
  ModalContainer,
  ModalDialog,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
} from "@heroui/react";
import { enrichmentProgress, type EnrichmentStoreState } from "@/lib/enrichment-progress";

export function EnrichmentSummaryModal() {
  const [state, setState] = useState<EnrichmentStoreState>({ job: null, summary: null });

  useEffect(() => enrichmentProgress.subscribe(setState), []);

  const s = state.summary;

  return (
    <Modal
      isOpen={s !== null}
      onOpenChange={(open: boolean) => {
        if (!open) enrichmentProgress.dismissSummary();
      }}
    >
      <ModalBackdrop>
        <ModalContainer>
          <ModalDialog>
            <ModalHeader>ההעשרה הסתיימה</ModalHeader>
            <ModalBody>
              {s && (
                <div className="space-y-1 text-sm text-foreground">
                  <p>{s.processed} מתוך {s.total} אנשי קשר הועשרו</p>
                  <p>{s.emails} אימיילים חדשים</p>
                  <p>{s.phones} מספרי טלפון חדשים</p>
                  {s.shared > 0 && <p className="text-default-500">{s.shared} עודכנו משיתוף</p>}
                  {s.skipped > 0 && <p className="text-warning">{s.skipped} דולגו (חריגה מתקציב)</p>}
                  {s.timedOut && <p className="text-default-500">ההעשרה ממשיכה ברקע…</p>}
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button
                color="primary"
                onPress={() => enrichmentProgress.dismissSummary()}
              >
                סגור
              </Button>
            </ModalFooter>
          </ModalDialog>
        </ModalContainer>
      </ModalBackdrop>
    </Modal>
  );
}
