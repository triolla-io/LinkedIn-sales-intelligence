import * as react from 'react';

type DecisionStatus = 'active' | 'superseded';
/** Where the PM currently is in the app (from useCurrentPage). Sent on every call. */
interface Page {
    name: string;
    route: string;
}
/** One line of the clarify conversation. The client owns the full transcript. */
interface Turn {
    role: 'pm' | 'assistant';
    content: string;
}
/** A single plain-English question. `chips` are tappable 1–3 word answers ([] = free-text only). */
interface ClarifyQuestion {
    id: string;
    prompt: string;
    chips: string[];
    allowFreeText: boolean;
}
/**
 * Hidden structured intent emitted by the backend when the goal is understood.
 * OPAQUE to the UI — never read its fields; pass it straight back to /commit.
 */
interface InternalBrief {
    goal: string;
    problem: string;
    desiredOutcomes: string[];
    constraints: string[];
    affectedArea: Page;
    sizeHint: 'tiny' | 'medium' | 'large';
    devNotes: string[];
    rawText: string;
    conversationDigest: string;
}
/** POST /pm-bridge/converse response. `held` can occur here too (unclear after 3 rounds). */
type ConverseResponse = {
    type: 'clarify';
    questions: ClarifyQuestion[];
} | {
    type: 'ready';
    goal: string;
    brief: InternalBrief;
} | {
    type: 'held';
};
/** POST /pm-bridge/commit response. */
type CommitResponse = {
    type: 'filed' | 'merged' | 'held';
};
/** Recorded product decision — the /decisions contract is UNCHANGED. */
interface ProductDecision {
    id: string;
    statement: string;
    contextRoute?: string;
    createdBy: string;
    status: DecisionStatus;
    supersededBy?: string | null;
    createdAt: string;
}
/**
 * One Done ticket awaiting the PM's review. Unlike the filing flow, the tracker
 * deliberately exposes Jira keys and links — the PM needs them to check the work.
 */
interface TrackerTicket {
    key: string;
    type: string;
    summary: string;
    doneAt: string;
    url: string;
}
/** GET /pm-bridge/tracker response. */
interface TrackerResponse {
    tickets: TrackerTicket[];
}

interface PmBridgeProps {
    boxUrl: string;
    getToken: () => Promise<string> | string;
    theme?: 'light' | 'dark';
    zIndexBase?: number;
    portalTarget?: () => HTMLElement;
    getPage?: () => Page;
}
declare function PmBridge({ boxUrl, getToken, theme, zIndexBase, portalTarget, getPage }: PmBridgeProps): react.JSX.Element | null;

type PmbErrorKind = 'unreachable' | 'unauthorized' | 'forbidden' | 'not_configured' | 'jira_error' | 'validation' | 'not_found' | 'unexpected';
declare class PmbApiError extends Error {
    readonly kind: PmbErrorKind;
    readonly status?: number | undefined;
    readonly serverMessage?: string | undefined;
    constructor(kind: PmbErrorKind, status?: number | undefined, serverMessage?: string | undefined);
}
/** Spec §9 copy — what the panel shows the PM for each failure mode. */
declare function friendlyMessage(err: unknown): string;
interface PmBridgeClientOptions {
    boxUrl: string;
    getToken: () => Promise<string> | string;
}
declare class PmBridgeClient {
    private readonly base;
    private readonly getToken;
    constructor(opts: PmBridgeClientOptions);
    /** One request; on 401 refresh the token via getToken and retry exactly once (PROTOCOL). */
    private request;
    private parse;
    converse(messages: Turn[], page: Page): Promise<ConverseResponse>;
    commitTicket(brief: InternalBrief, page: Page): Promise<CommitResponse>;
    fetchTracker(): Promise<TrackerResponse>;
    verifyTicket(key: string): Promise<void>;
    reopenTicket(key: string, comment: string): Promise<void>;
    listDecisions(): Promise<ProductDecision[]>;
    createDecision(statement: string, contextRoute?: string): Promise<ProductDecision>;
    patchDecision(id: string, patch: {
        status?: 'superseded';
        supersededBy?: string;
        statement?: string;
    }): Promise<ProductDecision>;
}

export { type ClarifyQuestion, type CommitResponse, type ConverseResponse, type InternalBrief, type Page, PmBridge, PmBridgeClient, type PmBridgeClientOptions, type PmBridgeProps, PmbApiError, type PmbErrorKind, type ProductDecision, type TrackerResponse, type TrackerTicket, type Turn, friendlyMessage };
