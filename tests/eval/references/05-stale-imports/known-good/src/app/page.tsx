import { formatDateTime } from "@/lib/date-utils";
import { formatMoney } from "@/lib/format-utils";

export default function Page() {
  const now = formatDateTime(new Date());
  const total = formatMoney(123.45);
  return (
    <main>
      <p>{now}</p>
      <p>{total}</p>
    </main>
  );
}
