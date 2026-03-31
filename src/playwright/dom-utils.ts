export interface VisibleButtonSummary {
  text: string;
  role: string;
  type: string | null;
  ariaLabel: string | null;
}

export interface FormSummary {
  id: string | null;
  name: string | null;
  method: string | null;
  action: string | null;
  inputCount: number;
  submitLabels: string[];
}

export interface ObserveSummary {
  visibleTexts: string[];
  visibleButtons: VisibleButtonSummary[];
  forms: FormSummary[];
  pageSignatureGuess: string;
}
