export const toLocalDate = (input) => {
  const d = new Date(input);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()); // без времени
};
