import { PageFrame } from "@/components/site-header";

export default function PrivacyPage() {
  return (
    <PageFrame>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-black">Privacy notice</h1>
        <div className="mt-6 space-y-4 rounded-lg border border-[#ded6ca] bg-white p-6 text-sm leading-7 text-[#5c5148]">
          <p>PlaiceToMeat Ops processes customer name, phone number, optional email, order contents, pickup details, and operational audit records.</p>
          <p>Customer personal data should be anonymised after the configured retention period, recommended at two years for V1.</p>
          <p>Compliance records are business records and should be retained for at least two years. Audit logs should be retained for at least one year.</p>
        </div>
      </main>
    </PageFrame>
  );
}
