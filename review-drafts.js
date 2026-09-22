export const outcomes = {
  working_well: 'Working well',
  setup_suggestion: 'Setup suggestion',
  form_concern: 'Form concern',
  not_assessable: 'Cannot assess from this video',
  not_adjudicated: 'Unsure — keep for review',
};

export function validateDecision(decision, duration) {
  if (!Object.hasOwn(outcomes, decision.expected))
    throw Error('Choose an expected label.');
  if (!decision.feedback?.trim())
    throw Error('Add the feedback you think the coach should give.');
  if (decision.feedback.length > 4000 || decision.note.length > 4000)
    throw Error('Keep feedback and notes under 4,000 characters each.');
  const hasStart = decision.start !== '',
    hasEnd = decision.end !== '';
  if (hasStart !== hasEnd)
    throw Error('Mark both the start and end, or leave both blank.');
  if (
    hasStart &&
    (!Number.isFinite(Number(decision.start)) ||
      !Number.isFinite(Number(decision.end)) ||
      Number(decision.start) < 0 ||
      Number(decision.end) <= Number(decision.start) ||
      Number(decision.end) > duration + 0.1)
  )
    throw Error(
      'Use an evidence interval within this clip, with the end after the start.',
    );
  return {
    expected: decision.expected,
    feedback: decision.feedback.trim(),
    note: decision.note.trim(),
    windows: hasStart ? [[Number(decision.start), Number(decision.end)]] : [],
  };
}

export class ReviewDrafts {
  /** @param {CryptoKey} key @param {string} namespace @param {Pick<Storage, 'getItem' | 'setItem'>} storage */
  constructor(
    key,
    namespace,
    storage = {
      getItem: (id) => localStorage.getItem(id),
      setItem: (id, value) => localStorage.setItem(id, value),
    },
  ) {
    this.key = key;
    this.namespace = namespace;
    this.storage = storage;
    this.entries = [];
    this.warning = '';
  }
  async load() {
    try {
      const raw = this.storage.getItem(this.namespace);
      if (raw) {
        const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
        const decoded = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: bytes.slice(0, 12) },
          this.key,
          bytes.slice(12),
        );
        const payload = JSON.parse(new TextDecoder().decode(decoded));
        if (payload.version !== 1 || !Array.isArray(payload.decisions))
          throw Error('Unknown draft format');
        this.entries = payload.decisions;
      }
    } catch {
      this.warning =
        'Saved drafts could not be read. Export new decisions before leaving this page.';
    }
  }
  identity(entry) {
    return `${entry.caseId}:${entry.videoSHA256}:${entry.baseReferenceSHA256}:${entry.checkId}`;
  }
  find(context, checkId) {
    return this.entries.find(
      (e) => this.identity(e) === this.identity({ ...context, checkId }),
    );
  }
  async save(entry) {
    // Preserve the in-memory copy if browser storage is unavailable so export still works.
    const next = this.entries.filter(
      (e) => this.identity(e) !== this.identity(entry),
    );
    next.push(entry);
    this.entries = next;
    if (this.warning)
      throw Error(
        'Draft kept in this tab only. Export it before leaving; browser storage is unavailable.',
      );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        this.key,
        new TextEncoder().encode(JSON.stringify(this.export())),
      ),
    );
    const bytes = new Uint8Array(iv.length + encrypted.length);
    bytes.set(iv);
    bytes.set(encrypted, iv.length);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    try {
      this.storage.setItem(this.namespace, btoa(binary));
    } catch {
      throw Error(
        'Draft kept in this tab only. Export it before leaving; browser storage is unavailable.',
      );
    }
  }
  export() {
    return {
      version: 1,
      kind: 'form-lab-reference-decisions',
      exerciseFamily: 'lunges',
      exportedAt: new Date().toISOString(),
      status: 'proposed_reference_changes',
      decisions: this.entries,
    };
  }
}
