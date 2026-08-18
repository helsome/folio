import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { InvestmentThesis, ThesisStance } from '@finagent/core';
import { updateThesis } from '../../client/thesis';
import { Button } from '../primitives/Button';

const STANCES: ThesisStance[] = ['bullish', 'bearish', 'neutral'];

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

interface ListFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const ListField: React.FC<ListFieldProps> = ({ label, value, onChange, placeholder }) => (
  <label className="flex flex-col gap-1.5">
    <span className="text-sm font-medium text-foreground/70">{label}</span>
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={3}
      className="mac-input px-3 py-2 rounded-[10px] text-[13px] text-foreground placeholder:text-foreground/38 focus:outline-none focus:ring-2 focus:ring-accent/28 transition-smooth"
    />
  </label>
);

/** Editable thesis fields (one entry per line for the list fields) + save. */
export const ThesisEditor: React.FC<{
  thesis: InvestmentThesis;
  onCancel: () => void;
  onSaved: (thesis: InvestmentThesis) => void;
}> = ({ thesis, onCancel, onSaved }) => {
  const { t } = useTranslation();
  const [stance, setStance] = useState<ThesisStance>(thesis.stance);
  const [summary, setSummary] = useState(thesis.summary);
  const [bullCase, setBullCase] = useState(thesis.bullCase.join('\n'));
  const [bearCase, setBearCase] = useState(thesis.bearCase.join('\n'));
  const [catalysts, setCatalysts] = useState(thesis.catalysts.join('\n'));
  const [risks, setRisks] = useState(thesis.risks.join('\n'));
  const [targetPrice, setTargetPrice] = useState(thesis.targetPrice?.toString() ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const parsedPrice = Number(targetPrice.trim());
    const edited: InvestmentThesis = {
      ...thesis,
      stance,
      summary,
      bullCase: splitLines(bullCase),
      bearCase: splitLines(bearCase),
      catalysts: splitLines(catalysts),
      risks: splitLines(risks),
      ...(Number.isFinite(parsedPrice) && targetPrice.trim() !== '' ? { targetPrice: parsedPrice } : {}),
    };
    const saved = await updateThesis(edited);
    setSaving(false);
    // Channel absent → keep the local edit so the editor still behaves gracefully.
    onSaved(saved ?? edited);
  };

  return (
    <div className="space-y-3 rounded-[10px] border border-foreground/8 p-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
          {t('thesis.editor.stance')}
        </span>
        <div className="flex gap-1">
          {STANCES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setStance(option)}
              className={`rounded-full px-3 py-1 text-[12px] transition-smooth ${
                stance === option
                  ? 'bg-[var(--mac-blue)] text-white'
                  : 'bg-foreground/8 text-foreground/70 hover:bg-foreground/14'
              }`}
            >
              {t(`thesis.stance.${option}`)}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground/70">{t('thesis.editor.coreThesis')}</span>
        <textarea
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          rows={2}
          className="mac-input px-3 py-2 rounded-[10px] text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-accent/28 transition-smooth"
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <ListField label={t('thesis.editor.bullCase')} value={bullCase} onChange={setBullCase} placeholder={t('thesis.editor.onePointPerLine')} />
        <ListField label={t('thesis.editor.bearCase')} value={bearCase} onChange={setBearCase} placeholder={t('thesis.editor.onePointPerLine')} />
        <ListField label={t('thesis.editor.catalysts')} value={catalysts} onChange={setCatalysts} placeholder={t('thesis.editor.onePointPerLine')} />
        <ListField label={t('thesis.editor.risks')} value={risks} onChange={setRisks} placeholder={t('thesis.editor.onePointPerLine')} />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-foreground/70">{t('thesis.editor.targetPriceOptional')}</span>
        <input
          value={targetPrice}
          onChange={(event) => setTargetPrice(event.target.value)}
          inputMode="decimal"
          placeholder={t('thesis.editor.targetPricePlaceholder')}
          className="mac-input px-3 py-2 rounded-[10px] text-[13px] text-foreground focus:outline-none focus:ring-2 focus:ring-accent/28 transition-smooth"
        />
      </label>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? t('thesis.editor.saving') : t('common.save')}
        </Button>
      </div>
    </div>
  );
};
