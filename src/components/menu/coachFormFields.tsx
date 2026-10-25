import { useId } from "react";
import { AlertCircle } from "lucide-react";

/** The look of the coach account forms, shared by the local and the server login screens. */
export const LABEL_CLASS =
  "mb-1.5 block text-xs font-heading font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400";

export function inputClass(hasError: boolean): string {
  return `w-full rounded-lg border bg-gray-50 p-3 text-gray-900 outline-none transition-all placeholder:text-gray-400 focus:ring-2 dark:bg-navy-900 dark:text-white dark:placeholder:text-gray-500 ${
    hasError
      ? "border-red-400 focus:border-red-500 focus:ring-red-500/20 dark:border-red-500"
      : "border-gray-300 focus:border-primary-500 focus:ring-primary-500/20 dark:border-navy-600"
  }`;
}

export function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 flex items-center gap-1 text-xs text-red-500">
      <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  error?: string;
  maxLength?: number;
  /** Earlier values to offer in the field's dropdown. */
  suggestions?: string[];
}

/** A labelled text input with its error under it. */
export function TextField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  error,
  maxLength,
  suggestions,
}: TextFieldProps) {
  const inputId = useId();
  const listId = useId();
  const errorId = useId();
  return (
    <div>
      <label htmlFor={inputId} className={LABEL_CLASS}>
        {label}
      </label>
      <input
        id={inputId}
        type={type}
        autoComplete={autoComplete}
        maxLength={maxLength}
        list={suggestions?.length ? listId : undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={inputClass(Boolean(error))}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {suggestions?.length ? (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
}
