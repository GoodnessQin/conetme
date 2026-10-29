export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-label="ConnectMe"
      className="select-none font-extrabold leading-none tracking-[-0.05em] text-brand"
      style={{ fontSize: size }}
    >
      connect<span className="ml-0.5 rounded-full bg-lime px-[.3em] pb-[.06em] text-brand">me</span>
    </span>
  );
}

export function LogoMark({ size = 40 }: { size?: number }) {
  return <img src="/logo-mark.svg" width={size} height={size} alt="ConnectMe" />;
}
