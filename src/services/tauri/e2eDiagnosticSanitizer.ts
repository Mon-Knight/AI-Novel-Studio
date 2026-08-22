const MAX_DEPTH = 4;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_FIELDS = 30;
const MAX_TEXT_LENGTH = 500;

const SAFE_DIAGNOSTIC_FIELDS = new Set(['command', 'errorMessage']);
const SENSITIVE_FIELD =
  /^(?:args?|arguments?|prompt|prompts|headers?|body|payload|input|messages?|content|completion|response|token|accessToken|refreshToken|apiKey|key|auth|authorization|password|secret|cookie|url|uri)$/i;
const SENSITIVE_TEXT =
  /(?:\bargs?\s*[:=]|\bprompt\s*[:=]|\bheaders?\s*[:=]|\bbody\s*[:=]|\bpayload\s*[:=]|\b(?:api[_ -]?key|token|auth(?:orization)?|password|secret|cookie)\b)/i;

function extractSafeDiagnosticFields(text: string): string[] {
  const fields: string[] = [];
  const pattern = /\b(command|errorMessage)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|([^\s,;]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = match[1] === 'command' ? 'command' : 'errorMessage';
    const value = redactDiagnosticText(match[2] ?? match[3] ?? match[4] ?? '');
    fields.push(`${name}=${value}`);
  }
  return fields;
}

export function redactDiagnosticText(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (SENSITIVE_TEXT.test(text)) {
    const safeFields = extractSafeDiagnosticFields(text);
    return safeFields.length > 0
      ? `[REDACTED_SENSITIVE_LOG] ${safeFields.join(' ')}`
      : '[REDACTED_SENSITIVE_LOG]';
  }

  return text
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_KEY]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s"']+/gi, '[REDACTED_URL]')
    .replace(/[A-Za-z]:\\[^\n"']+/g, '[REDACTED_PATH]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .slice(0, MAX_TEXT_LENGTH);
}

function isSensitiveField(name: string): boolean {
  return !SAFE_DIAGNOSTIC_FIELDS.has(name) && SENSITIVE_FIELD.test(name);
}

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'bigint' || typeof value === 'symbol') {
    return redactDiagnosticText(value);
  }
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (value instanceof Error) {
    return {
      name: redactDiagnosticText(value.name),
      errorMessage: redactDiagnosticText(value.message),
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof URL !== 'undefined' && value instanceof URL) return '[REDACTED_URL]';
  if (typeof value !== 'object') return redactDiagnosticText(value);
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[MaxDepth]';

  seen.add(value);
  if (Array.isArray(value)) {
    try {
      const result = value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => sanitizeValue(item, seen, depth + 1));
      if (value.length > MAX_ARRAY_ITEMS)
        result.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
      return result;
    } catch {
      return '[Uninspectable Array]';
    }
  }

  const result: Record<string, unknown> = {};
  let descriptors: Array<[string, PropertyDescriptor]>;
  let fieldCount: number;
  try {
    descriptors = Object.entries(Object.getOwnPropertyDescriptors(value)).slice(
      0,
      MAX_OBJECT_FIELDS,
    );
    fieldCount = Reflect.ownKeys(value).length;
  } catch {
    return '[Uninspectable Object]';
  }
  for (const [key, descriptor] of descriptors) {
    if (isSensitiveField(key)) {
      result[key] = '[REDACTED]';
    } else if ('value' in descriptor) {
      result[key] = sanitizeValue(descriptor.value, seen, depth + 1);
    } else {
      result[key] = '[Accessor omitted]';
    }
  }
  if (fieldCount > MAX_OBJECT_FIELDS) result.__truncatedFields = fieldCount - MAX_OBJECT_FIELDS;
  return result;
}

export function sanitizeDiagnosticValue(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet<object>(), 0);
}

function labelsSensitiveFollowingArgument(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^(?:args?|prompt|headers?|body|payload|input|messages?|content|token|key|auth(?:orization)?|password|secret|cookie)\s*:?\s*$/i.test(
      value,
    )
  );
}

export function serializeConsoleArguments(args: unknown[]): string {
  const values = args.map((value, index) =>
    index > 0 && labelsSensitiveFollowingArgument(args[index - 1])
      ? '[REDACTED]'
      : sanitizeDiagnosticValue(value),
  );
  try {
    return JSON.stringify(values).slice(0, MAX_TEXT_LENGTH);
  } catch {
    return '[UNSERIALIZABLE_CONSOLE_ARGUMENTS]';
  }
}
