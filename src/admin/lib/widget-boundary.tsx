import { Component, Suspense, type ReactNode } from "react"
import en from "../i18n/json/en.json"
import { AdminQueryProvider } from "./admin-query-client"
import { useCheckoutTranslation } from "./checkout-i18n"

type Props = {
  /** Human label shown in the fallback so the operator knows which widget broke. */
  label: string
  children: ReactNode
}

type State = { error: Error | null }

const staticNotice = <div className="mt-1 text-xs text-ui-fg-subtle">{en.widgetError}</div>

const ErrorNotice = () => {
  const { t } = useCheckoutTranslation()
  return <div className="mt-1 text-xs text-ui-fg-subtle">{t("widgetError")}</div>
}

// The diagnostic card must render even when the translation layer caused the error.
class ErrorNoticeBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? staticNotice : (
      <Suspense fallback={staticNotice}><ErrorNotice /></Suspense>
    )
  }
}

/**
 * Class-based error boundary scoped to a single admin widget.
 *
 * Why this exists: Medusa's admin renders all injected widgets on a page
 * (e.g. `product.list.before`) inside its own global error boundary. When
 * one widget throws during render or commit, the *page* boundary fires and
 * the whole route shows "An error occurred." That hides every other widget
 * and the actual page content. Wrapping each widget in its own boundary
 * keeps the failure local: the broken widget shows a small fallback, the
 * rest of the page renders fine.
 */
export class WidgetBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Surfaced in devtools / Sentry-style hooks if installed.
    // eslint-disable-next-line no-console
    console.error(
      `[admin widget "${this.props.label}"] render error:`,
      error
    )
  }

  render() {
    if (this.state.error) {
      const err = this.state.error
      const message =
        err && typeof err.message === "string" && err.message.length > 0
          ? err.message
          : err && typeof err.toString === "function"
            ? String(err)
            : "Unknown render error"
      // Trim stack to the first 6 frames so it fits in the boundary card
      // without scrolling, but is enough to identify the failure point.
      const stack =
        err && typeof err.stack === "string"
          ? err.stack.split("\n").slice(0, 6).join("\n")
          : ""
      return (
        <div className="rounded-lg border border-ui-border-error bg-ui-bg-subtle p-4 text-ui-fg-base">
          <div className="text-xs font-semibold uppercase tracking-wider text-ui-fg-error">
            {this.props.label}
          </div>
          <ErrorNoticeBoundary />
          <div className="mt-2 text-xs font-mono text-ui-fg-base whitespace-pre-wrap break-all">
            {message}
          </div>
          {stack ? (
            <details className="mt-2">
              <summary className="text-xs cursor-pointer text-ui-fg-subtle">
                Stack
              </summary>
              <pre className="mt-1 text-[10px] font-mono text-ui-fg-subtle whitespace-pre-wrap break-all">
                {stack}
              </pre>
            </details>
          ) : null}
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * HOC wrapper for default-exported widgets. Use as:
 *
 *   export default withWidgetBoundary(MyWidget, "Sales dashboard")
 */
export const withWidgetBoundary = <P extends object>(
  WidgetComponent: (props: P) => ReactNode,
  label: string
) => {
  const Wrapped = (props: P) => (
    <WidgetBoundary label={label}>
      <AdminQueryProvider>
        <WidgetComponent {...props} />
      </AdminQueryProvider>
    </WidgetBoundary>
  )
  Wrapped.displayName = `WithWidgetBoundary(${label})`
  return Wrapped
}

/**
 * Same pattern for full admin routes: error boundary + shared QueryClient.
 * Use as: `export default withRouteBoundary(MyPage, "My page")`.
 */
export const withRouteBoundary = <P extends object>(
  PageComponent: (props: P) => ReactNode,
  label: string
) => {
  const Wrapped = (props: P) => (
    <WidgetBoundary label={label}>
      <AdminQueryProvider>
        <PageComponent {...props} />
      </AdminQueryProvider>
    </WidgetBoundary>
  )
  Wrapped.displayName = `WithRouteBoundary(${label})`
  return Wrapped
}
