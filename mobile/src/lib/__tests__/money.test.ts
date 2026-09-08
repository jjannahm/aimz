import { formatEgp, formatEgpRound, parseEgp, poundsOf } from '@/src/lib/money';

describe('formatEgp', () => {
  it('reads a whole subscription as pounds', () => {
    expect(formatEgp(120000)).toBe('1,200.00 EGP');
  });

  it('keeps the piastres that are not a whole pound', () => {
    expect(formatEgp(1230)).toBe('12.30 EGP');
    expect(formatEgp(1)).toBe('0.01 EGP');
  });

  it('says nothing owed as nothing rather than a blank', () => {
    expect(formatEgp(0)).toBe('0.00 EGP');
  });

  // A refund is a negative row, so it has to read as one.
  it('marks a refund with a minus sign', () => {
    expect(formatEgp(-5000)).toBe('−50.00 EGP');
  });
});

describe('parseEgp', () => {
  it('takes what somebody would actually type', () => {
    expect(parseEgp('1200')).toBe(120000);
    expect(parseEgp('12.30')).toBe(1230);
    expect(parseEgp('1,200.50')).toBe(120050);
    expect(parseEgp(' 1200 EGP ')).toBe(120000);
  });

  it('rounds rather than dropping what is past two places', () => {
    expect(parseEgp('12.345')).toBe(1235);
    expect(parseEgp('0.005')).toBe(1);
  });

  it('refuses anything that is not an amount', () => {
    for (const text of ['', 'abc', '.', '1.2.3', '-']) expect(parseEgp(text)).toBeNull();
  });

  it('survives the round trip a form makes', () => {
    for (const piastres of [0, 1, 999, 120000, 100_000_000]) {
      expect(parseEgp(poundsOf(piastres))).toBe(piastres);
    }
  });
});

describe('formatEgpRound', () => {
  // A report says what a family owes; the trailing .00 is accounting noise, and
  // at report size it is what pushes an amount onto a second line.
  it('drops the decimals when there are none', () => {
    expect(formatEgpRound(360000)).toBe('3,600 EGP');
    expect(formatEgpRound(70000)).toBe('700 EGP');
    expect(formatEgpRound(0)).toBe('0 EGP');
  });

  it('keeps them when the amount is not whole pounds', () => {
    expect(formatEgpRound(1230)).toBe('12.30 EGP');
    expect(formatEgpRound(1)).toBe('0.01 EGP');
  });

  it('marks a refund the same way the exact figure does', () => {
    expect(formatEgpRound(-5000)).toBe('−50 EGP');
    expect(formatEgpRound(-1230)).toBe('−12.30 EGP');
  });
});
