import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import type { AuthorizeLetter } from '@gs/shared';
import { useAuthorizeLetter } from '../../features/hooks';
import './printFonts';
import s from './print.module.css';
import a from './authorizeLetter.module.css';
import { useAutoPrint } from './useAutoPrint';

const DOTS = '……………………';

/** A check box of the form, ticked or empty. */
const Box = ({ on }: { on?: boolean }) => <span className={a.box}>{on ? '✓' : ''}</span>;

/**
 * The import transfer of rights (លិខិតផ្ទេរសិទ្ធិ) from the owner of the goods to us as customs
 * broker, filled in from the saved shipment: Print / Save as PDF.
 */
export function PrintAuthorizePage() {
  const { id = '' } = useParams();
  const q = useAuthorizeLetter(id);
  const l = q.data?.letter;
  useEffect(() => {
    if (l) document.title = l.title;
  }, [l]);
  useAutoPrint(!!l);
  if (q.isLoading) return <div className={s.page}>Loading…</div>;
  if (!l)
    return (
      <div className={s.page}>
        <div className={s.sheet}>
          <p>The transfer of rights can’t be printed yet. It still needs:</p>
          <ul>
            {(q.data?.missing ?? ['The shipment could not be loaded']).map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  return (
    <div className={s.page}>
      <div className={s.toolbar}>
        <button type="button" className={s.btn} onClick={() => window.close()}>
          Close
        </button>
        <button type="button" className={s.btnPrimary} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
      <AuthorizeLetterSheet letter={l} />
    </div>
  );
}

/** The transfer of rights as one A4 sheet (also the last page of the permit set). */
export function AuthorizeLetterSheet({ letter: l }: { letter: AuthorizeLetter }) {
  const { owner, broker } = l;
  return (
    <div className={`${s.sheet} ${a.letter}`}>
      <div className={`${a.kingdom} ${a.moul}`}>
        <div>ព្រះរាជាណាចក្រកម្ពុជា</div>
        <div>ជាតិ សាសនា ព្រះមហាក្សត្រ</div>
      </div>
      <div className={a.rule} />
      <div className={`${a.title} ${a.moul}`}>លិខិតផ្ទេរសិទ្ធិ</div>
      <p className={a.p} style={{ textAlign: 'center' }}>
        សម្រាប់ម្ចាស់ទំនិញជូននីតិបុគ្គលជើងសាគយ
        <Box /> រូបវន្តបុគ្គលជើងសាគយ
        <Box />
      </p>
      <p className={`${a.p} ${a.indent}`}>
        ខ្ញុំបាទ/នាងខ្ញុំ {owner.name} អត្តសញ្ញាណប័ណ្ណសញ្ជាតិខ្មែរ/លិខិតឆ្លងដែនលេខ {owner.idNo}
      </p>
      <p className={a.p}>
        ជាប្រធានក្រុមហ៊ុន
        <Box on /> សមាជិកក្រុមប្រឹក្សាភិបាល
        <Box /> ផ្សេងទៀត
        <Box /> <span className={a.dots}>{DOTS}</span>
      </p>
      <p className={a.p}>
        នៃក្រុមហ៊ុន/សហគ្រាស {owner.company} អត្តសញ្ញាណកម្មសារពើពន្ធ (VAT)លេខ {owner.vattin}{' '}
        ទូរស័ព្ទលេខ {owner.phone} ។
      </p>
      <p className={a.p}>
        និងជាម្ចាស់ទំនិញ <span className={a.b}>សូមផ្ទេរសិទ្ធិជូន</span> លោក
        <Box on /> លោកស្រី
        <Box /> <span className={a.b}>{broker.grantee.name}</span>
      </p>
      <p className={a.p}>
        អត្តសញ្ញាណប័ណ្ណសញ្ជាតិខ្មែរ/លិខិតឆ្លងដែនលេខ {broker.grantee.idNo} ទូរស័ព្ទលេខ៖{' '}
        {broker.grantee.phone}
      </p>
      <p className={a.p}>
        ជាប្រធាន/អនុប្រធាន ក្រុមហ៊ុន/សហគ្រាស {broker.company} មានអត្តសញ្ញាណកម្មសារពើពន្ធ(VAT)លេខ{' '}
        {broker.vattin} និងមានរូបវន្តបុគ្គលជើងសាគយ តំណាងដោយលោក
        <Box on /> លោកស្រី
        <Box /> <span className={a.b}>{broker.agent.name}</span>{' '}
        អត្តសញ្ញាណប័ណ្ណសញ្ជាតិខ្មែរ/លិខិតឆ្លងដែនលេខ {broker.agent.idNo} ទូរស័ព្ទលេខ{' '}
        {broker.agent.phone} ប័ណ្ណសម្គាល់ជើងសាគយលេខ{broker.cardNo} ផុតសុពលភាពថ្ងៃទី{' '}
        {broker.cardExpiry}
      </p>
      <p className={`${a.p} ${a.b}`}>ដើម្បីបំពេញបែបបទបញ្ចេញទំនិញពីគយ៖</p>
      <p className={a.p}>
        <Box />
        សម្រាប់មួយប្រតិបត្តិការនៅ<span className={a.dots}>……</span>
        <span className={a.b}>{l.office}</span>
      </p>
      <p className={a.p}>តាមឯកសារភ្ជាប់ដូចខាងក្រោម៖</p>
      <div className={a.docs}>
        {l.documents.map((d, i) => (
          <span key={d.label} style={{ display: 'contents' }}>
            <span>
              {['១', '២', '៣'][i]}- {d.label}
              <span className={a.dots}>……</span> {d.no}
            </span>
            <span>{d.date ? `ចុះថ្ងៃទី ${d.date}` : ''}</span>
          </span>
        ))}
        <span>
          ៤- ឯកសារគាំទ្រផ្សេងទៀត<span className={a.dots}>{DOTS + DOTS}</span>
        </span>
        <span />
      </div>
      <div className={a.dates}>
        <div>{l.lunarDate}</div>
        <div>{l.madeAt}</div>
      </div>
      <div className={a.signs}>
        <div>
          <span className={a.moul}>ហត្ថលេខានិងត្រាអ្នកទទួលសិទ្ធិ</span>
          <span className={a.b}>ឈ្មោះ៖ {broker.grantee.name}</span>
        </div>
        <div />
        <div>
          <span className={a.moul}>ហត្ថលេខានិងត្រាអ្នកផ្ទេរសិទ្ធិ</span>
          <span className={a.b}>ឈ្មោះ៖ {owner.name}</span>
        </div>
      </div>
      <div className={a.signs}>
        <div className={a.thumb}>
          <span className={a.moul}>ស្នាមមេដៃស្ដាំជើងសារគយ</span>
          <span className={a.b}>ឈ្មោះ៖ {broker.agent.name}</span>
        </div>
      </div>
    </div>
  );
}
