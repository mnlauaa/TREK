import type { CostsSettlement } from '../../../../components/Budget/costsModel';
import { NOTE_MAX } from '../../../../components/Budget/CostsPanel.helpers';
import ItemExchangeRateFields from '../../../../components/Budget/ItemExchangeRateFields';
import { useSettlementForm } from '../../../../components/Budget/useSettlementForm';
import CurrencySelect from '../../../../components/shared/CurrencySelect';
import { CustomDatePicker } from '../../../../components/shared/CustomDateTimePicker';
import { useTranslation } from '../../../../i18n';
import type { TranslationFn, TripMember } from '../../../../types';
import { localizeAmountInput, zeroAmountInput } from '../../../../utils/formatters';
import MChip from '../../../components/MChip';
import MCostMemberAvatar from '../../../components/MCostMemberAvatar';
import MSheet from '../../../components/MSheet';
import { Eyebrow, FIELD_AREA_CLS, FIELD_CLS, FormSheetFooter, FormSheetHeader } from './PlSheetChrome';

export default function MCostPaymentSheet({
  open,
  editing,
  onClose,
  tripId,
  base,
  tripCurrency,
  people,
  me,
  toast,
  t,
  onSaved,
}: {
  open: boolean;
  editing: CostsSettlement | null;
  onClose: () => void;
  tripId: number;
  base: string;
  tripCurrency: string;
  people: TripMember[];
  me: number;
  toast: { error: (message: string) => void; info: (message: string) => void };
  t: TranslationFn;
  onSaved: () => void;
}) {
  const { locale } = useTranslation();
  const {
    fromId,
    setFromId,
    toId,
    setToId,
    amount,
    setAmount,
    currency,
    setCurrency,
    day,
    setDay,
    note,
    setNote,
    saving,
    rate,
    valid,
    save,
  } = useSettlementForm({
    tripId,
    tripCurrency,
    base,
    people,
    me,
    editing,
    open,
    t,
    toast,
    onSaved,
    oneSaveAtATime: true,
  });

  const title = editing ? t('costs.editPayment') : t('costs.addPayment');

  return (
    <MSheet open={open} onClose={onClose} ariaLabel={title}>
      <FormSheetHeader title={title} onClose={onClose} closeLabel={t('common.close')} />
      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-[6px] pt-1">
        <Eyebrow className="mb-[7px] uppercase">{t('costs.from')}</Eyebrow>
        <div className="flex flex-wrap gap-[6px]">
          {people.map((p) => (
            <MChip key={p.id} active={fromId === p.id} onClick={() => setFromId(p.id)}>
              <MCostMemberAvatar
                name={p.username}
                avatarUrl={p.avatar_url}
                variant={fromId === p.id ? 'accent' : 'neutral'}
                size={16}
              />
              {p.id === me ? t('costs.you') : p.username}
            </MChip>
          ))}
        </div>

        <Eyebrow className="mb-[7px] mt-[14px] uppercase">{t('costs.to')}</Eyebrow>
        <div className="flex flex-wrap gap-[6px]">
          {people.map((p) => (
            <MChip key={p.id} active={toId === p.id} onClick={() => setToId(p.id)}>
              <MCostMemberAvatar
                name={p.username}
                avatarUrl={p.avatar_url}
                variant={toId === p.id ? 'accent' : 'neutral'}
                size={16}
              />
              {p.id === me ? t('costs.you') : p.username}
            </MChip>
          ))}
        </div>

        <Eyebrow className="mb-[7px] mt-[14px] uppercase">{t('costs.amount')}</Eyebrow>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={localizeAmountInput(amount, currency)}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={zeroAmountInput(currency)}
            className={FIELD_CLS}
          />
          <span className="flex-none font-geist text-caption font-bold text-m-faint">{currency}</span>
        </div>

        <div className="mt-[14px] flex gap-2">
          <div className="min-w-0 flex-1">
            <Eyebrow className="mb-[7px] uppercase">{t('costs.currency')}</Eyebrow>
            <CurrencySelect value={currency} onChange={setCurrency} searchable size="sm" style={{ width: '100%' }} />
          </div>
          <div className="min-w-0 flex-1">
            <Eyebrow className="mb-[7px] uppercase">{t('costs.day')}</Eyebrow>
            <CustomDatePicker value={day} onChange={setDay} style={{ width: '100%' }} />
          </div>
        </div>

        <ItemExchangeRateFields
          rate={rate}
          currency={currency}
          tripCurrency={tripCurrency}
          amount={Number(amount) || 0}
          t={t}
          locale={locale}
          mobile
        />
        <Eyebrow className="mb-[6px] mt-[14px] uppercase">{t('costs.note')}</Eyebrow>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={NOTE_MAX}
          placeholder={t('costs.paymentNotePlaceholder')}
          className={FIELD_AREA_CLS}
        />
      </div>
      <FormSheetFooter
        onCancel={onClose}
        cancelLabel={t('common.cancel')}
        onSubmit={() => void save()}
        submitLabel={editing ? t('common.save') : t('costs.addPayment')}
        submitDisabled={!valid || saving}
      />
    </MSheet>
  );
}
