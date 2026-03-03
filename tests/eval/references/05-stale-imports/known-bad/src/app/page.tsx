import { formatDate } from "@/lib/date-utils";
import { formatCurrency } from "@/lib/format-utils";

export default function Page() {
  return (
    <main>
      <p>{formatDate(new Date())}</p>
      <p>{formatCurrency(123.45)}</p>
    </main>
  );
}
