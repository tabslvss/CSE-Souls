/**
 * Every image in src/art is bundled and fingerprinted at build time. Looking them up here
 * means the site never requests a picture that does not exist: until a file is added, the
 * art drawn in code is simply what shows.
 */
const files = import.meta.glob<string>('./art/*.{webp,png,jpg}', {
  eager: true,
  query: '?url',
  import: 'default',
});

export function artUrl(name: string): string | undefined {
  return files[`./art/${name}.webp`] ?? files[`./art/${name}.png`] ?? files[`./art/${name}.jpg`];
}
