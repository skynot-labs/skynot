import { paths } from "../paths";

export function Brand({
  tagline = true,
  assetBase = paths.brand,
}: {
  tagline?: boolean;
  assetBase?: string;
}) {
  return (
    <span class="sk-brand">
      <img
        src={`${assetBase}skynot-logo.svg`}
        width="164"
        height="40"
        alt="skynot"
      />
      {tagline && <small>AN AGENT DEV SHOP</small>}
    </span>
  );
}
