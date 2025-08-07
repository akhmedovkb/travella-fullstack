// Преобразует дату в локальный объект Date (без временной зоны)
export const toLocalDate = (strOrDate) => {
  if (strOrDate instanceof Date) {
    return new Date(
      strOrDate.getFullYear(),
      strOrDate.getMonth(),
      strOrDate.getDate()
    );
  }

  if (typeof strOrDate === "string") {
    const [year, month, day] = strOrDate.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  if (typeof strOrDate === "object" && strOrDate.date) {
    const [year, month, day] = strOrDate.date.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  return new Date(strOrDate);
};
