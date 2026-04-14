/**
 * Scans text for potential secrets, API keys, tokens, and credentials.
 * Used to prevent accidental secret leakage in handoffs and memory files.
 */

const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  // API keys and tokens
  { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/ },
  { name: 'AWS Secret Key', pattern: /[0-9a-zA-Z/+]{40}(?=[^0-9a-zA-Z/+]|$)/ },
  { name: 'GitHub Token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: 'GitHub Classic Token', pattern: /ghp_[A-Za-z0-9]{36}/ },
  { name: 'Slack Token', pattern: /xox[baprs]-[0-9a-zA-Z-]+/ },
  { name: 'Stripe Key', pattern: /sk_live_[0-9a-zA-Z]{24,}/ },
  { name: 'Stripe Restricted Key', pattern: /rk_live_[0-9a-zA-Z]{24,}/ },
  { name: 'OpenAI Key', pattern: /sk-[A-Za-z0-9]{32,}/ },
  { name: 'Anthropic Key', pattern: /sk-ant-[A-Za-z0-9-]{32,}/ },
  { name: 'Google API Key', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Vercel Token', pattern: /vercel_[A-Za-z0-9]{24,}/ },
  { name: 'npm Token', pattern: /npm_[A-Za-z0-9]{36,}/ },
  { name: 'Supabase Key', pattern: /sbp_[a-f0-9]{40}/ },
  { name: 'Twilio Key', pattern: /SK[0-9a-f]{32}/ },
  { name: 'SendGrid Key', pattern: /SG\.[A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]{43,}/ },
  { name: 'Mailgun Key', pattern: /key-[0-9a-f]{32}/ },
  { name: 'Firebase Key', pattern: /AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}/ },

  // Generic patterns
  { name: 'Private Key', pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/ },
  { name: 'Bearer Token', pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/ },
  { name: 'Basic Auth', pattern: /Basic\s+[A-Za-z0-9+/]+=*/ },
  { name: 'JWT Token', pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { name: 'Connection String', pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s"']+:[^\s"']+@/ },
  { name: 'Password in URL', pattern: /\/\/[^:]+:[^@]+@/ },

  // Key=value patterns (catches KEY=actual_secret_value)
  { name: 'Env Value Assignment', pattern: /(?:SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|AUTH|API_KEY)\s*=\s*['"]?[A-Za-z0-9+/=_-]{16,}['"]?/i },
];

export interface SecretMatch {
  name: string;
  value: string;       // the matched text (truncated for safety)
  field: string;       // which field it was found in
}

export class SecretScanner {
  /**
   * Scan an object's string values for potential secrets.
   * Returns an array of matches. Empty array = safe.
   */
  static scan(obj: Record<string, unknown>, parentField = ''): SecretMatch[] {
    const matches: SecretMatch[] = [];

    for (const [key, value] of Object.entries(obj)) {
      const field = parentField ? `${parentField}.${key}` : key;

      if (typeof value === 'string') {
        for (const { name, pattern } of SECRET_PATTERNS) {
          const match = value.match(pattern);
          if (match) {
            matches.push({
              name,
              value: match[0].slice(0, 8) + '...' + match[0].slice(-4),
              field,
            });
          }
        }
      } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (typeof item === 'string') {
            for (const { name, pattern } of SECRET_PATTERNS) {
              const match = item.match(pattern);
              if (match) {
                matches.push({
                  name,
                  value: match[0].slice(0, 8) + '...' + match[0].slice(-4),
                  field: `${field}[${i}]`,
                });
              }
            }
          } else if (typeof item === 'object' && item !== null) {
            matches.push(...SecretScanner.scan(item as Record<string, unknown>, `${field}[${i}]`));
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        matches.push(...SecretScanner.scan(value as Record<string, unknown>, field));
      }
    }

    return matches;
  }

  /**
   * Redact secrets in-place by replacing matched values with [REDACTED].
   */
  static redact(obj: Record<string, unknown>, parentField = ''): void {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        let redacted = value;
        for (const { pattern } of SECRET_PATTERNS) {
          redacted = redacted.replace(pattern, '[REDACTED]');
        }
        if (redacted !== value) {
          obj[key] = redacted;
        }
      } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (typeof value[i] === 'string') {
            let redacted = value[i] as string;
            for (const { pattern } of SECRET_PATTERNS) {
              redacted = redacted.replace(pattern, '[REDACTED]');
            }
            if (redacted !== value[i]) {
              value[i] = redacted;
            }
          } else if (typeof value[i] === 'object' && value[i] !== null) {
            SecretScanner.redact(value[i] as Record<string, unknown>);
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        SecretScanner.redact(value as Record<string, unknown>);
      }
    }
  }

  /**
   * Check if a string looks like a key=value assignment (not just a key name).
   * Used to enforce env_vars_added only contains names, not values.
   */
  static looksLikeKeyValue(str: string): boolean {
    return /=/.test(str) && !/^[A-Z_]+=\s*$/.test(str);
  }
}
