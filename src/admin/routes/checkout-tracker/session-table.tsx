import { Fragment, useState } from "react"
import { Badge, Text } from "@medusajs/ui"

import { StageDots } from "./funnel"
import {
  DEVICE_LABEL,
  formatAgo,
  formatDateTime,
  formatMoney,
  shortId,
} from "./format"
import {
  STAGES,
  STAGE_COLOR,
  STAGE_LABEL,
  type SessionItem,
  type SessionRow,
  type VisitorGroup,
} from "./types"

const MAX_THUMBS = 3

/**
 * Why several carts were shown as one shopper. Surfaced on the row so a merge
 * can be judged rather than taken on faith — the anonymous rule is a
 * probability, not a fact.
 */
const MERGE_REASON: Record<VisitorGroup["matched_by"], string> = {
  customer: "Rovnaký zákaznícky účet",
  email: "Rovnaký e-mail",
  repeat_cart: "Rovnaký košík z rovnakého zariadenia o pár minút",
  single: "",
}

/**
 * Item thumbnails with a "+N" cap so a 12-item cart cannot blow up the row
 * height.
 *
 * Laid out side by side rather than stacked: overlapping avatars saved a few
 * pixels but hid most of every thumbnail behind the next one, which defeats the
 * point of showing the basket at a glance. The free gift is pushed to the end
 * so the cap never spends a slot on the €0 promo instead of a real product.
 */
const CartPreview = ({ items }: { items: SessionItem[] }) => {
  if (!items.length) {
    return <span className="text-[11px] text-ui-fg-muted">—</span>
  }

  const ordered = [
    ...items.filter((item) => !item.is_gift),
    ...items.filter((item) => item.is_gift),
  ]
  const shown = ordered.slice(0, MAX_THUMBS)
  const rest = ordered.length - shown.length

  return (
    <div className="flex items-center gap-x-2.5">
      <div className="flex items-center gap-x-1">
        {shown.map((item, i) => (
          <span
            key={`${item.sku ?? item.title}-${i}`}
            title={`${item.quantity}× ${item.title}`}
            className="size-10 shrink-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base"
          >
            {item.thumbnail ? (
              <img
                src={item.thumbnail}
                alt=""
                className="size-full object-cover"
                loading="lazy"
              />
            ) : (
              <span className="flex size-full items-center justify-center text-[10px] font-medium text-ui-fg-muted">
                {item.title.slice(0, 2).toUpperCase()}
              </span>
            )}
          </span>
        ))}
        {rest > 0 ? (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-ui-border-base bg-ui-bg-subtle text-[11px] font-semibold text-ui-fg-subtle">
            +{rest}
          </span>
        ) : null}
      </div>
      <span className="min-w-0 truncate text-[11.5px] text-ui-fg-subtle">
        {shown.map((item) => `${item.quantity}× ${item.title}`).join(", ")}
        {rest > 0 ? ` +${rest} ďalšie` : ""}
      </span>
    </div>
  )
}

const StagePill = ({ stage }: { stage: SessionRow["stage"] }) => (
  <span
    className="inline-flex items-center gap-x-1.5 rounded-full px-2 py-[3px] text-[10.5px] font-medium"
    style={{
      background: `${STAGE_COLOR[stage]}1f`,
      color: STAGE_COLOR[stage],
    }}
  >
    {STAGE_LABEL[stage]}
  </span>
)

const ExpandedItems = ({
  items,
  currency,
}: {
  items: SessionItem[]
  currency: string
}) => (
  <div className="flex flex-col gap-y-1.5 rounded-lg bg-ui-bg-subtle p-3">
    {items.map((item, i) => (
      <div
        key={`${item.sku ?? item.title}-${i}`}
        className="flex items-center justify-between gap-x-3 text-[11.5px]"
      >
        <span className="min-w-0 flex-1 truncate text-ui-fg-base">
          {item.quantity}× {item.title}
        </span>
        {item.sku ? (
          <span className="shrink-0 font-mono text-[10.5px] text-ui-fg-muted">
            {item.sku}
          </span>
        ) : null}
        <span className="w-20 shrink-0 text-right tabular-nums text-ui-fg-subtle">
          {formatMoney(item.quantity * item.unit_price, currency)}
        </span>
      </div>
    ))}
  </div>
)

/**
 * The per-shopper list — who is stuck, with what in the basket, and where they
 * were last seen.
 *
 * Rows expand rather than link out: the operator's next action is usually to
 * read the basket and decide whether to call, not to open a cart detail page
 * that Medusa's admin does not have.
 */
export const SessionTable = ({
  visitors,
  now,
}: {
  visitors: VisitorGroup[]
  now: number
}) => {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (!visitors.length) {
    return (
      <Text size="small" className="mt-4 text-ui-fg-subtle">
        Žiadne košíky pre zvolený filter.
      </Text>
    )
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse">
        <thead>
          <tr className="border-b border-ui-border-base text-left">
            {["Kedy", "Zákazník", "Obsah košíka", "Hodnota", "Dostal sa po", "Odišiel z"].map(
              (head) => (
                <th
                  key={head}
                  className="pb-2 text-[10.5px] font-medium uppercase tracking-wide text-ui-fg-muted"
                >
                  {head}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {visitors.map((visitor) => {
            // One row per shopper. `lead` is the cart that got furthest, so the
            // row shows the state worth acting on rather than whichever cart
            // happened to be created last.
            const session = visitor.lead
            const isOpen = expanded === visitor.key
            return (
              <Fragment key={visitor.key}>
                <tr
                  onClick={() => setExpanded(isOpen ? null : visitor.key)}
                  className="cursor-pointer border-b border-ui-border-base align-middle transition-colors hover:bg-ui-bg-subtle-hover"
                >
                  <td className="py-2.5 pr-3">
                    <div className="text-[12px] text-ui-fg-base">
                      {formatAgo(session.created_at, now)}
                    </div>
                    <div className="text-[10.5px] text-ui-fg-muted">
                      {formatDateTime(session.created_at)}
                    </div>
                  </td>

                  <td className="py-2.5 pr-3">
                    {session.email ? (
                      <div className="max-w-[190px] truncate text-[12px] text-ui-fg-base">
                        {session.email}
                      </div>
                    ) : (
                      <div className="text-[12px] italic text-ui-fg-muted">
                        Anonym
                      </div>
                    )}
                    <div className="mt-0.5 flex items-center gap-x-1.5">
                      <span className="font-mono text-[10px] text-ui-fg-muted">
                        {shortId(session.cart_id)}
                      </span>
                      {session.customer_id ? (
                        <Badge size="2xsmall" color="grey">
                          účet
                        </Badge>
                      ) : null}
                      {visitor.cart_count > 1 ? (
                        <Badge
                          size="2xsmall"
                          color="orange"
                          title={MERGE_REASON[visitor.matched_by]}
                        >
                          {visitor.cart_count} košíky
                        </Badge>
                      ) : null}
                    </div>
                  </td>

                  <td className="max-w-[340px] py-2.5 pr-3">
                    <CartPreview items={session.items} />
                  </td>

                  <td className="py-2.5 pr-3 text-[12px] font-semibold tabular-nums text-ui-fg-base">
                    {formatMoney(session.total, session.currency_code)}
                  </td>

                  <td className="py-2.5 pr-3">
                    <div className="flex flex-col items-start gap-y-1">
                      <StagePill stage={session.stage} />
                      <StageDots stage={session.stage} all={[...STAGES]} />
                    </div>
                  </td>

                  <td className="py-2.5">
                    {session.last_path ? (
                      <div className="max-w-[180px] truncate font-mono text-[11px] text-ui-fg-base">
                        {session.last_path}
                      </div>
                    ) : (
                      <div
                        className="text-[11px] text-ui-fg-muted"
                        title="Bez súhlasu s analytikou sa stránkové údaje nezbierajú — poradie krokov pochádza z košíka."
                      >
                        bez súhlasu
                      </div>
                    )}
                    <div className="mt-0.5 flex items-center gap-x-1.5 text-[10.5px] text-ui-fg-muted">
                      {session.device ? (
                        <span>{DEVICE_LABEL[session.device] ?? session.device}</span>
                      ) : null}
                      {session.locale ? (
                        <span className="uppercase">{session.locale}</span>
                      ) : null}
                      {session.last_seen_at ? (
                        <span>· {formatAgo(session.last_seen_at, now)}</span>
                      ) : null}
                    </div>
                  </td>
                </tr>

                {isOpen ? (
                  <tr className="border-b border-ui-border-base">
                    <td colSpan={6} className="px-0 py-2.5">
                      <ExpandedItems
                        items={session.items}
                        currency={session.currency_code}
                      />
                      {visitor.cart_count > 1 ? (
                        <div className="mt-2 px-3">
                          <div className="text-[10.5px] uppercase tracking-wide text-ui-fg-muted">
                            {MERGE_REASON[visitor.matched_by]}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                            {visitor.carts.map((c) => (
                              <span
                                key={c.cart_id}
                                className="font-mono text-[10.5px] text-ui-fg-subtle"
                                title={formatDateTime(c.created_at)}
                              >
                                {shortId(c.cart_id)}
                                {c.cart_id === session.cart_id ? " ←" : ""}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
