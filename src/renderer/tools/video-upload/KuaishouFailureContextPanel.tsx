import type { KuaishouPageActionErrorDetails } from "../../../main/video-upload/types";
import { Card } from "../../shared/components/Card";
import { StatusBadge } from "../../shared/components/StatusBadge";

export function parseKuaishouFailureContext(message: string): KuaishouPageActionErrorDetails | null {
  if (!message.trim()) return null;

  try {
    const value = JSON.parse(message) as Partial<KuaishouPageActionErrorDetails>;
    if (typeof value.code !== "string" || typeof value.message !== "string" || typeof value.pageType !== "string" || typeof value.currentUrl !== "string") {
      return null;
    }
    return {
      code: value.code as KuaishouPageActionErrorDetails["code"],
      message: value.message,
      step: value.step === "applyFormState" ? value.step : "applyFormState",
      locatorKey: value.locatorKey,
      field: value.field,
      requestedValue: value.requestedValue,
      currentPageValue: value.currentPageValue,
      candidates: Array.isArray(value.candidates) ? value.candidates : undefined,
      pageType: value.pageType as KuaishouPageActionErrorDetails["pageType"],
      currentUrl: value.currentUrl,
      capabilities: value.capabilities || emptyCapabilities(),
      locatorAttempts: Array.isArray(value.locatorAttempts) ? value.locatorAttempts : []
    };
  } catch {
    return null;
  }
}

export function formatKuaishouFailureMessage(message: string): string {
  const details = parseKuaishouFailureContext(message);
  if (!details) return message;

  const candidates = details.candidates?.length
    ? `候选：${details.candidates.map((candidate) => candidate.label).slice(0, 8).join("、")}`
    : "";
  return [details.message, candidates].filter(Boolean).join(" ");
}

export function KuaishouFailureContextPanel({ details }: { details: KuaishouPageActionErrorDetails | null }) {
  if (!details) return null;

  const matchedCapabilities = Object.entries(details.capabilities)
    .filter(([, value]) => value)
    .map(([key]) => key);

  return (
    <Card title="失败上下文">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <StatusBadge value={details.code} />
          <StatusBadge value={details.pageType} />
          {details.field ? <StatusBadge value={details.field} /> : null}
          {details.locatorKey ? <StatusBadge value={details.locatorKey} /> : null}
        </div>

        <div className="grid gap-2 text-xs text-slate-600">
          <Info label="step" value={details.step} />
          <Info label="url" value={details.currentUrl} />
          <Info label="message" value={details.message} />
          {details.requestedValue !== undefined ? <Info label="requested" value={details.requestedValue} /> : null}
          {details.currentPageValue !== undefined ? <Info label="current" value={details.currentPageValue} /> : null}
        </div>

        {details.candidates?.length ? (
          <div>
            <h3 className="text-xs font-semibold uppercase text-slate-500">Candidates</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {details.candidates.slice(0, 12).map((candidate, index) => (
                <span key={`${candidate.value}-${index}`} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                  {candidate.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <h3 className="text-xs font-semibold uppercase text-slate-500">Matched Capabilities</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {matchedCapabilities.length > 0 ? matchedCapabilities.map((capability) => <StatusBadge key={capability} value={capability} />) : <span className="text-sm text-slate-500">None</span>}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase text-slate-500">Locator Attempts</h3>
          <div className="mt-2 space-y-2">
            {details.locatorAttempts.length > 0 ? (
              details.locatorAttempts.map((attempt, index) => (
                <pre key={index} className="max-h-36 overflow-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                  {JSON.stringify(attempt, null, 2)}
                </pre>
              ))
            ) : (
              <span className="text-sm text-slate-500">None</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[82px_1fr] gap-2 rounded-md bg-slate-50 px-2 py-1">
      <span className="font-medium text-slate-500">{label}</span>
      <span className="min-w-0 break-all text-slate-800">{value || "-"}</span>
    </div>
  );
}

function emptyCapabilities(): KuaishouPageActionErrorDetails["capabilities"] {
  return {
    hasEditableContent: false,
    hasDraftContinueButton: false,
    hasCaptionEditor: false,
    hasPublishTimeInput: false,
    hasFileInput: false,
    hasUploadEntryButton: false,
    hasCoverSettings: false,
    hasPkCoverSwitch: false,
    hasChapterButton: false,
    hasAuthorServiceSelect: false,
    hasBenefitSelect: false,
    hasHotspotInput: false,
    hasAuthorStatementInput: false,
    hasCollectionSelect: false,
    hasLocationRegionSelect: false,
    hasLocationAddressInput: false,
    hasInteractionSettings: false,
    hasVisibilitySettings: false,
    hasPublishTimingSettings: false,
    hasUploadProgress: false,
    hasUploadComplete: false,
    hasPublishButton: false,
    hasErrorToast: false,
    loginRequired: false
  };
}
