/** Small stroke icons used by the navigation. 24x24, inherit colour from the parent. */
type P = { size?: number };
const base = (size = 24) => ({ width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true });
export const HomeIcon = ({ size }: P) => <svg {...base(size)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h5v-6h4v6h5V9.5" /></svg>;
export const RequestsIcon = ({ size }: P) => <svg {...base(size)}><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
export const JobsIcon = ({ size }: P) => <svg {...base(size)}><rect x="3" y="7" width="18" height="13" rx="3" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 13h18" /></svg>;
export const BellIcon = ({ size }: P) => <svg {...base(size)}><path d="M6 17V11a6 6 0 1 1 12 0v6l1.5 2h-15L6 17Z" /><path d="M10 21h4" /></svg>;
export const DashboardIcon = ({ size }: P) => <svg {...base(size)}><rect x="3" y="3" width="7.5" height="9" rx="2" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="2" /><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2" /><rect x="3" y="15" width="7.5" height="6" rx="2" /></svg>;
export const ShieldIcon = ({ size }: P) => <svg {...base(size)}><path d="M12 3 4.5 6v5.5c0 4.6 3 8 7.5 9.5 4.5-1.5 7.5-4.9 7.5-9.5V6L12 3Z" /><path d="m9 12 2.2 2.2L15.5 10" /></svg>;
export const AlertIcon = ({ size }: P) => <svg {...base(size)}><path d="M12 4 2.8 19h18.4L12 4Z" /><path d="M12 10v4M12 17h.01" /></svg>;
export const GridIcon = ({ size }: P) => <svg {...base(size)}><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></svg>;
export const WalletIcon = ({ size }: P) => <svg {...base(size)}><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M3 10h18M16 15h2" /><path d="M6 6l9-3 1 3" /></svg>;
export const UsersIcon = ({ size }: P) => <svg {...base(size)}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14.2c2.9.3 5 2.6 5 5.8" /></svg>;
export const CoinIcon = ({ size }: P) => <svg {...base(size)}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5c.4-1 1.4-1.5 2.5-1.5 1.5 0 2.5.8 2.5 2s-1 1.7-2.5 2-2.5.8-2.5 2 1 2 2.5 2c1.1 0 2.1-.5 2.5-1.5M12 6v2M12 16v2" /></svg>;
