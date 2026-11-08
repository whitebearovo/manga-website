import { useEffect, useState } from "react";
import { ArrowUpRight, Menu, Settings2, X } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { cn } from "../lib/utils";

const navItems = [
  { label: "首页", to: "/" },
  { label: "章节", to: "/#chapters" },
  { label: "关于", to: "/#about" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.hash]);

  if (location.pathname.startsWith("/admin")) return null;

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="brand" to="/" aria-label="夜页首页">
          <span className="brand__mark" aria-hidden="true">
            <span />
            <span />
          </span>
          <span className="brand__word">夜页</span>
          <span className="brand__latin">YORU</span>
        </Link>

        <nav className="desktop-nav" aria-label="主导航">
          {navItems.map((item) =>
            item.to.includes("#") ? (
              <a key={item.to} href={item.to} className="nav-link">
                {item.label}
              </a>
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => cn("nav-link", isActive && "is-active")}
                end
              >
                {item.label}
              </NavLink>
            ),
          )}
          <Link className="nav-link nav-link--admin" to="/admin">
            <Settings2 size={15} strokeWidth={1.8} />
            管理
          </Link>
        </nav>

        <a className="header-read" href="/#chapters">
          开始阅读 <ArrowUpRight size={15} />
        </a>

        <button
          type="button"
          className="menu-toggle"
          aria-label={open ? "关闭菜单" : "打开菜单"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      <div className={cn("mobile-menu", open && "is-open")}>
        {navItems.map((item) =>
          item.to.includes("#") ? (
            <a key={item.to} href={item.to} onClick={() => setOpen(false)}>
              {item.label}
            </a>
          ) : (
            <Link key={item.to} to={item.to}>
              {item.label}
            </Link>
          ),
        )}
        <Link to="/admin">内容管理</Link>
      </div>
    </header>
  );
}
