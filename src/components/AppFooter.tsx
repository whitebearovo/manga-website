import { ArrowUpRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

export function AppFooter() {
  const location = useLocation();
  if (location.pathname.startsWith("/admin")) return null;

  return (
    <footer className="site-footer">
      <div className="site-footer__main page-width">
        <div className="footer-brand">
          <span className="footer-brand__cn">夜页</span>
          <span className="footer-brand__en">YORU / MANGA ROOM</span>
        </div>
        <p className="footer-note">把每一页，留到夜晚。</p>
        <div className="footer-links">
          <Link to="/">回到书架</Link>
          <Link to="/admin">
            内容管理 <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
      <div className="site-footer__bottom page-width">
        <span>© {new Date().getFullYear()} YORU</span>
        <span>Powered by Cloudflare R2 + Pages</span>
      </div>
    </footer>
  );
}
