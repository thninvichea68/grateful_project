import { useEffect, useState } from 'react';

const TZ = 'Asia/Phnom_Penh';

// Fixed labels like the prototype: Intl month names vary by ICU version ("Sep" vs "Sept").
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Wall-clock fields in Phnom Penh, read as numbers so formatting never depends on locale data. */
export function clockParts(now: Date) {
  const fields = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute', number>;
  const weekday = new Date(Date.UTC(fields.year, fields.month - 1, fields.day)).getUTCDay();
  const h12 = fields.hour % 12 === 0 ? 12 : fields.hour % 12;
  return {
    day: DAYS[weekday]!,
    date: `${String(fields.day).padStart(2, '0')}, ${MONTHS[fields.month - 1]} ${String(fields.year).slice(-2)}`,
    time: `${String(h12).padStart(2, '0')}:${String(fields.minute).padStart(2, '0')} ${fields.hour >= 12 ? 'PM' : 'AM'}`,
  };
}

/** Top-bar date/time widget. Always shows Phnom Penh time (UTC+7), whatever the viewer's zone. */
export function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    // Align updates to the start of each minute.
    const first = window.setTimeout(
      () => {
        tick();
        intervalId = window.setInterval(tick, 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    let intervalId: number | undefined;
    return () => {
      window.clearTimeout(first);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);
  const p = clockParts(now);
  return (
    <div className="datetime-widget" aria-label={`${p.day} ${p.date}, ${p.time} Phnom Penh time`}>
      <div className="dt-col">
        <div className="day">{p.day}</div>
        <div className="date">{p.date}</div>
      </div>
      <time className="time" dateTime={now.toISOString()}>
        {p.time}
      </time>
      <div className="cambodia-flag" title="Phnom Penh, Cambodia (UTC+7)">
        <img
          src="/khmer-flag.svg"
          alt=""
          width={28}
          height={18}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: 3,
          }}
        />
      </div>
    </div>
  );
}
