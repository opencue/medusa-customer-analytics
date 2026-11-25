import en from "./json/en.json"
import ar from "./json/ar.json"
import bg from "./json/bg.json"
import bs from "./json/bs.json"
import cs from "./json/cs.json"
import de from "./json/de.json"
import el from "./json/el.json"
import es from "./json/es.json"
import fa from "./json/fa.json"
import fi from "./json/fi.json"
import fr from "./json/fr.json"
import he from "./json/he.json"
import hr from "./json/hr.json"
import hu from "./json/hu.json"
import id from "./json/id.json"
import it from "./json/it.json"
import ja from "./json/ja.json"
import ko from "./json/ko.json"
import lt from "./json/lt.json"
import mk from "./json/mk.json"
import mn from "./json/mn.json"
import nl from "./json/nl.json"
import pl from "./json/pl.json"
import ptBR from "./json/ptBR.json"
import ptPT from "./json/ptPT.json"
import ro from "./json/ro.json"
import ru from "./json/ru.json"
import sk from "./json/sk.json"
import sv from "./json/sv.json"
import th from "./json/th.json"
import tr from "./json/tr.json"
import uk from "./json/uk.json"
import vi from "./json/vi.json"
import zhCN from "./json/zhCN.json"
import zhTW from "./json/zhTW.json"

const catalogs = { ar, bg, bs, cs, de, el, en, es, fa, fi, fr, he, hr, hu, id, it, ja, ko, lt, mk, mn, nl, pl, ptBR, ptPT, ro, ru, sk, sv, th, tr, uk, vi, zhCN, zhTW, enGB: en }

export default Object.fromEntries(
  Object.entries(catalogs).map(([language, messages]) => [
    language,
    { "checkout-analytics": messages },
  ])
)
