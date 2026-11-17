/** The ConnectMe mark (two linked rings) beside the wordmark. Blue and green are taken from the mark itself. */
export function Logo({ size = 28 }: { size?: number }) {
  const h = Math.round(size * 1.2);
  return (
    <span aria-label="ConnectMe" className="inline-flex select-none items-center gap-2">
      <img src="/logo-mark.png" alt="" style={{ height: h, width: "auto" }} />
      <span className="font-extrabold leading-none tracking-[-0.045em]" style={{ fontSize: Math.round(size * 0.98) }}>
        <span style={{ color: "#0035DD" }}>connect</span><span style={{ color: "#5DAE3A" }}>me</span>
      </span>
    </span>
  );
}

export function LogoMark({ size = 40 }: { size?: number }) {
  return <img src="/logo-mark.png" height={size} style={{ height: size, width: "auto" }} alt="ConnectMe" />;
}
