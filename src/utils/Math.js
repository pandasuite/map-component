// eslint-disable-next-line import/prefer-default-export
export const toFixed = (number, digit) => {
  const mult = Number('1'.padEnd(digit + 1, '0'));

  return Math.round((number + Number.EPSILON) * mult) / mult;
};
