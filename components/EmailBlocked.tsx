import { tabDisqualificationMessage } from "@/lib/tabSwitch";

export default function EmailBlocked({ email: _email }: { email?: string }) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-red-300">Disqualified</h1>
        <p className="mt-3 text-slate-300">{tabDisqualificationMessage()}</p>
        <p className="mt-3 text-sm text-slate-500">
          You cannot continue, log in, or see your score with this email.
        </p>
      </div>
    </main>
  );
}
