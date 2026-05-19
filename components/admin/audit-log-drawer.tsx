"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/cn";

interface AuditLogDrawerProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function AuditLogDrawer({ userId, isOpen, onClose }: AuditLogDrawerProps) {
  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          "fixed right-0 top-0 h-full w-96 bg-white shadow-2xl z-50 transition-transform duration-200",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Audit Log</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mb-3">
              <span className="text-2xl">📋</span>
            </div>
            <p className="text-gray-500 text-sm">Audit log coming soon</p>
            <p className="text-gray-400 text-xs mt-1">
              User ID: <code className="font-mono">{userId}</code>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
