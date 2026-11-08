import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="not-found page-width">
      <div className="not-found__number" aria-hidden="true">
        404
      </div>
      <span className="eyebrow">PAGE NOT FOUND</span>
      <h1>这一页被折进了书脊。</h1>
      <p>地址可能已经改变，或者章节还没有上传。</p>
      <Link className="button button--ink" to="/">
        <ArrowLeft size={16} /> 返回书架
      </Link>
    </div>
  );
}
