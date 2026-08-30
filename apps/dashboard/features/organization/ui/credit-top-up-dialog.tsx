"use client";

import { useState } from "react";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { toast } from "@workspace/ui/components/sonner";
import { createCreditTopUpCheckoutAction } from "../data/credit-actions";

export type CreditTopUpProduct = {
  name: string;
  displayName: string;
  credits: number;
};

export const CreditTopUpDialog = NiceModal.create(
  ({
    organizationId,
    orgSlug,
    products,
  }: {
    organizationId: string;
    orgSlug: string;
    products: CreditTopUpProduct[];
  }) => {
    const modal = useModal();
    const [selectedProductName, setSelectedProductName] = useState(products[0]?.name ?? "");
    const [isLoading, setIsLoading] = useState(false);

    const selectedProduct = products.find((product) => product.name === selectedProductName);

    const handleCheckout = async () => {
      if (!selectedProduct) return;
      setIsLoading(true);
      try {
        const returnUrl = `${window.location.origin}/${orgSlug}/settings/billing`;
        const result = await createCreditTopUpCheckoutAction({
          organizationId,
          orgSlug,
          productName: selectedProduct.name,
          returnUrl,
        });
        if (result.url) {
          window.location.href = result.url;
          return;
        }
        toast.error("Unable to open checkout.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to start checkout");
      } finally {
        setIsLoading(false);
      }
    };

    return (
      <Dialog open={modal.visible} onOpenChange={(open) => !open && modal.hide()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buy Credits</DialogTitle>
            <DialogDescription>Add credits to this organization&apos;s wallet.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            {products.map((product) => (
              <button
                key={product.name}
                type="button"
                className="flex items-center justify-between rounded-md border p-3 text-left text-sm hover:bg-muted"
                data-selected={selectedProductName === product.name}
                onClick={() => setSelectedProductName(product.name)}
              >
                <span className="font-medium">{product.displayName}</span>
                <span>{product.credits.toLocaleString()} credits</span>
              </button>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => modal.hide()}>
              Cancel
            </Button>
            <Button onClick={handleCheckout} disabled={isLoading || !selectedProduct}>
              {isLoading ? "Opening..." : "Continue"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);
