import { Route, Routes } from "react-router-dom";
import { AppFooter } from "./components/AppFooter";
import { SiteHeader } from "./components/SiteHeader";
import { ScrollToTop } from "./components/ScrollToTop";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ReaderPage } from "./pages/ReaderPage";
import { SeriesPage } from "./pages/SeriesPage";

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
      <Route
        path="/read/:seriesId/:chapterNumber"
        element={<ReaderPage />}
      />
      <Route
        path="*"
        element={
          <div className="site-frame">
            <SiteHeader />
            <main>
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/series/:seriesId" element={<SeriesPage />} />
                <Route path="/admin" element={<AdminPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </main>
            <AppFooter />
          </div>
        }
      />
      </Routes>
    </>
  );
}
