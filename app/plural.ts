/** A count and its noun: "1 route", "2 routes". `many` is for the nouns that do not take an s. */
export const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;
