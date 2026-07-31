"use client";

type Option = { key: string; text: string };

function optionKey(index: number, lowercase: boolean) {
  const key = String.fromCharCode(65 + index);
  return lowercase ? key.toLowerCase() : key;
}

export function ModularOptionEditor({
  options,
  onChange,
  answerKey,
  onAnswerKeyChange,
}: {
  options: Option[];
  onChange: (options: Option[]) => void;
  answerKey?: string | null;
  onAnswerKeyChange?: (answerKey: string) => void;
}) {
  const lowercase = Boolean(options[0]?.key && options[0].key === options[0].key.toLowerCase());

  function addOption() {
    if (options.length >= 26) return;
    onChange([...options, { key: optionKey(options.length, lowercase), text: "" }]);
  }

  function removeOption(index: number) {
    if (options.length <= 2) return;
    const answerIndex = options.findIndex(
      (option) => option.key.toLowerCase() === answerKey?.toLowerCase(),
    );
    const next = options
      .filter((_, optionIndex) => optionIndex !== index)
      .map((option, optionIndex) => ({
        ...option,
        key: optionKey(optionIndex, lowercase),
      }));
    onChange(next);
    if (!onAnswerKeyChange || answerIndex < 0) return;
    if (answerIndex === index) onAnswerKeyChange("");
    else onAnswerKeyChange(optionKey(answerIndex > index ? answerIndex - 1 : answerIndex, lowercase));
  }

  return (
    <div className="modular-option-editor">
      {options.map((option, index) => (
        <div className="option-edit modular-option-row" key={`${option.key}-${index}`}>
          <strong>{option.key}</strong>
          <input
            value={option.text}
            placeholder={`Option ${option.key}`}
            onChange={(event) =>
              onChange(
                options.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, text: event.target.value } : item,
                ),
              )
            }
          />
          <button
            className="option-count-button"
            type="button"
            aria-label={`Remove option ${option.key}`}
            title="Remove option"
            disabled={options.length <= 2}
            onClick={() => removeOption(index)}
          >
            −
          </button>
        </div>
      ))}
      <button
        className="option-count-button add-option-button"
        type="button"
        disabled={options.length >= 26}
        onClick={addOption}
      >
        <span aria-hidden="true">+</span> Add option
      </button>
    </div>
  );
}
