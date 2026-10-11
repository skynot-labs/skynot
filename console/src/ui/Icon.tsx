const paths: Record<string, string> = {
  flower:
    "M12 9c-6-12-14 1-5 4-7 8 7 14 8 4 10 1 11-14 2-13-2-8-12-7-5 5Zm0 0a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z",
  sun: "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  plant: "M12 21V5m0 9H6V9m6 3h6V6M8 21h8",
  leaf: "M5 20C-4 5 13 3 21 3c0 15-11 20-16 17ZM5 20 16 9",
  snow: "M12 2v20M3 7l18 10M3 17 21 7M9 4l3 3 3-3M9 20l3-3 3 3",
  moon: "M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z",
  office: "M3 21V9l9-6 9 6v12M8 21v-7h8v7M3 9h18",
  orders: "m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m6 10v-2a4 4 0 0 0-3-3M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  context: "M4 3h6l2 2h8v16H4V3Zm4 7h8m-8 4h8m-8 4h5",
  usage: "M4 21V12m8 9V3m8 18V8M2 21h20",
  wallet: "M21 8H5a3 3 0 0 1 0-6h14v6M3 5v14a2 2 0 0 0 2 2h16V8m0 5h-6v4h6",
  check: "m7 12 3 3 7-7M21 12a9 9 0 1 1-5-8",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  close: "m6 6 12 12M6 18 18 6",
  pause: "M9 5v14M15 5v14",
  play: "m8 4 12 8-12 8V4Z",
  stop: "M5 5h14v14H5V5Z",
  settings:
    "M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0-6v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  edit: "m16 3 5 5-12 12-6 1 1-6L16 3ZM13 6l5 5",
  cursor: "m4 3 15 10-7 1-3 7L4 3Z",
  code: "m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2m3 6a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
  chat: "M21 4H3v14h6l3 4 3-4h6V4ZM7 9h10m-10 4h7",
  shield: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Zm-4 9 3 3 5-6",
  tokens: "m12 2 9 5v10l-9 5-9-5V7l9-5Zm-9 5 9 5 9-5M12 12v10",
  clock: "M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  help: "M9 9a3 3 0 1 1 5 2c-2 1-2 1-2 3m0 3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  sidebar: "M3 4h18v16H3V4Zm6 0v16",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z",
};
export function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[name] ?? paths.code} />
    </svg>
  );
}
