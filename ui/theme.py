import streamlit as st


def inject_global_styles() -> None:
    """Inject global light theme styles and component tweaks."""
    st.markdown(
        """
        <style>
        /* Global app background & typography */
        html, body {
            margin: 0;
            padding: 0;
            background: #f3f4f8;
        }
        .stApp {
            background: #f3f4f8;
            color: #111827;
        }

        /* Base text */
        html, body, [class^="css"]  {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text",
                         "Segoe UI", sans-serif;
            color: #111827;
        }

        /* Headings */
        .sp-page-header-title {
            font-size: 1.5rem;
            font-weight: 650;
            letter-spacing: 0.01em;
            margin-bottom: 0.15rem;
        }
        .sp-page-header-subtitle {
            font-size: 0.9rem;
            color: #6b7280;
            margin-bottom: 1.25rem;
        }

        /* Cards */
        .sp-card {
            background: #ffffff;
            border-radius: 14px;
            padding: 1.1rem 1.25rem;
            border: 1px solid rgba(15, 23, 42, 0.06);
            box-shadow:
                0 12px 25px rgba(15, 23, 42, 0.06);
            margin-bottom: 1.1rem;
        }
        .sp-card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 0.5rem;
        }
        .sp-card-title {
            font-size: 0.98rem;
            font-weight: 600;
        }
        .sp-card-subtitle {
            font-size: 0.8rem;
            color: #6b7280;
            margin-top: 0.15rem;
        }
        .sp-section-header {
            margin-bottom: 0.75rem;
        }

        /* Pills / chips */
        .sp-pill {
            display: inline-flex;
            align-items: center;
            padding: 0.12rem 0.5rem;
            border-radius: 999px;
            font-size: 0.75rem;
            font-weight: 500;
            letter-spacing: 0.02em;
            border: 1px solid rgba(148, 163, 184, 0.7);
            background: #eef2ff;
            color: #3730a3;
            margin-right: 0.25rem;
            margin-bottom: 0.1rem;
        }
        .sp-pill-muted {
            border-color: rgba(209, 213, 219, 0.9);
            background: #f3f4f6;
            color: #4b5563;
        }

        /* Sidebar */
        section[data-testid="stSidebar"] {
            background: #ffffff;
            border-right: 1px solid rgba(15, 23, 42, 0.08);
        }
        .sp-sidebar-app-title {
            font-weight: 650;
            font-size: 1rem;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: #111827;
            margin-bottom: 0.15rem;
        }
        .sp-sidebar-app-subtitle {
            font-size: 0.78rem;
            color: #6b7280;
            margin-bottom: 0.6rem;
        }
        .sp-sidebar-section-label {
            font-size: 0.72rem;
            text-transform: uppercase;
            letter-spacing: 0.13em;
            color: #9ca3af;
            margin-top: 0.4rem;
            margin-bottom: 0.15rem;
        }
        .sp-sidebar-help {
            font-size: 0.78rem;
            color: #6b7280;
            margin-top: 0.75rem;
        }

        /* Streamlit widget tweaks */
        .stMetric {
            background: #ffffff;
            border-radius: 12px;
            padding: 0.7rem 0.8rem;
            border: 1px solid rgba(15, 23, 42, 0.06);
        }
        .stMetric-label {
            font-size: 0.8rem !important;
            color: #6b7280 !important;
        }
        .stMetric-value {
            font-size: 1.1rem !important;
        }

        /* Tables & data editor */
        .stDataFrame, .stDataEditor {
            border-radius: 12px;
            overflow: hidden;
            background: #ffffff;
            border: 1px solid rgba(15, 23, 42, 0.06);
        }

        /* Footer */
        .sp-footer {
            font-size: 0.75rem;
            color: #6b7280;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def render_page_header(icon: str, title: str, subtitle: str | None = None) -> None:
    """Standard page header with icon, title, and optional subtitle."""
    with st.container():
        st.markdown(
            f"""
            <div class="sp-page-header-title">{icon} {title}</div>
            """,
            unsafe_allow_html=True,
        )
        if subtitle:
            st.markdown(
                f'<div class="sp-page-header-subtitle">{subtitle}</div>',
                unsafe_allow_html=True,
            )


def card(
    title: str | None = None,
    subtitle: str | None = None,
    right_content: str | None = None,
):
    """Context manager that renders a card container with optional header."""

    class _CardContext:
        def __enter__(self):
            self._container = st.container()
            self._container.markdown('<div class="sp-card">', unsafe_allow_html=True)
            if title or subtitle or right_content:
                # Header wrapper
                header_html = '<div class="sp-card-header">'
                header_html += '<div>'
                if title:
                    header_html += f'<div class="sp-card-title">{title}</div>'
                if subtitle:
                    header_html += f'<div class="sp-card-subtitle">{subtitle}</div>'
                header_html += "</div>"
                if right_content:
                    header_html += f'<div>{right_content}</div>'
                header_html += "</div>"
                self._container.markdown(header_html, unsafe_allow_html=True)
            return self._container

        def __exit__(self, exc_type, exc, tb):
            # Close card div
            self._container.markdown("</div>", unsafe_allow_html=True)

    return _CardContext()


def section(
    title: str | None = None,
    subtitle: str | None = None,
):
    """Context manager that renders a section header (title + subtitle) without a card bubble."""

    class _SectionContext:
        def __enter__(self):
            self._container = st.container()
            if title or subtitle:
                header_html = '<div class="sp-section-header">'
                if title:
                    header_html += f'<div class="sp-card-title">{title}</div>'
                if subtitle:
                    header_html += f'<div class="sp-card-subtitle">{subtitle}</div>'
                header_html += "</div>"
                self._container.markdown(header_html, unsafe_allow_html=True)
            return self._container

        def __exit__(self, exc_type, exc, tb):
            pass

    return _SectionContext()


def pill(text: str, muted: bool = False) -> None:
    """Render a small pill / chip label."""
    cls = "sp-pill sp-pill-muted" if muted else "sp-pill"
    st.markdown(f'<span class="{cls}">{text}</span>', unsafe_allow_html=True)

