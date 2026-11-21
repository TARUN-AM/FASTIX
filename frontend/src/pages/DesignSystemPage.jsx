import { CheckCircle2, Ticket } from "lucide-react";
import VerificationGate from "../components/verification/VerificationGate";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Table,
} from "../components/ui";
import {
  calculateMaxResalePrice,
  formatRupees,
  parseRupeesToPaise,
} from "../utils/formatMoney";

const MONEY_PARSE_EXAMPLES = [
  { input: "5000", expected: 500000 },
  { input: "5000.5", expected: 500050 },
  { input: "5000.50", expected: 500050 },
  { input: "0.01", expected: 1 },
  { input: "5,000", expected: null },
  { input: "5000.505", expected: null },
  { input: "abc", expected: null },
  { input: "", expected: null },
];

const DEMO_USER_NONE = {
  fullName: "Sample Fan",
  phoneVerified: false,
  identityStatus: "NOT_STARTED",
  identityVerified: false,
  walletLinked: false,
  walletAddress: null,
};

const DEMO_USER_PHONE_ONLY = {
  fullName: "Sample Fan",
  phoneVerified: true,
  identityStatus: "NOT_STARTED",
  identityVerified: false,
  walletLinked: false,
  walletAddress: null,
};

const DEMO_USER_FULLY_VERIFIED = {
  fullName: "Sample Fan",
  phoneVerified: true,
  identityStatus: "VERIFIED",
  identityVerified: true,
  walletLinked: false,
  walletAddress: null,
};

const DEMO_USER_WITH_WALLET = {
  fullName: "Sample Fan",
  phoneVerified: true,
  identityStatus: "VERIFIED",
  identityVerified: true,
  walletLinked: true,
  walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
};

function SampleProtectedChild() {
  return (
    <Card className="border-green-200 bg-green-50/70">
      <CardBody className="flex items-start gap-3">
        <CheckCircle2
          className="mt-0.5 h-5 w-5 shrink-0 text-success"
          aria-hidden="true"
        />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Ticket className="h-4 w-4 text-navy" aria-hidden="true" />
            <p className="text-sm font-semibold text-navy">
              Protected fan action unlocked
            </p>
          </div>
          <p className="text-xs text-slate-700">
            This sample child content renders only when all required
            verification steps are complete.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Development-only component showcase (/dev/design-system).
 */
export default function DesignSystemPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumb="Developer Preview"
        title="Design System Showcase"
        subtitle="Preview reusable FairTicket verification components and integer-paise money utilities."
        actions={<Badge tone="info">Dev Only</Badge>}
      />

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-navy">
            parseRupeesToPaise Unit Examples
          </h2>
          <p className="text-sm text-slate-600">
            Live integer-only rupee-to-paise parsing verification (no
            floating-point math) and 110% display resale cap check.
          </p>
        </div>

        <Table caption="parseRupeesToPaise live unit examples">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-4 py-3">Input</th>
              <th className="px-4 py-3">Expected</th>
              <th className="px-4 py-3">Actual</th>
              <th className="px-4 py-3">Formatted / 110% Cap</th>
              <th className="px-4 py-3">Match</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {MONEY_PARSE_EXAMPLES.map((row) => {
              const actual = parseRupeesToPaise(row.input);
              const passed = actual === row.expected;
              const cap =
                actual !== null ? calculateMaxResalePrice(actual) : null;
              return (
                <tr key={row.input || "(empty)"}>
                  <td className="px-4 py-2.5 font-mono text-xs text-navy">
                    {JSON.stringify(row.input)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">
                    {String(row.expected)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-navy">
                    {String(actual)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    {actual !== null
                      ? `${formatRupees(actual)} (cap: ${formatRupees(cap)})`
                      : "Rejected"}
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={passed ? "success" : "danger"}>
                      {passed ? "Pass" : "Fail"}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </section>

      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-navy">
            VerificationGate States
          </h2>
          <p className="text-sm text-slate-600">
            Visual preview of the reusable VerificationGate wrapper across
            verification progress states.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-navy">
                1. Nothing verified
              </h3>
              <Badge tone="neutral">0 / 2</Badge>
            </CardHeader>
            <CardBody>
              <VerificationGate user={DEMO_USER_NONE}>
                <SampleProtectedChild />
              </VerificationGate>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-navy">2. Phone only</h3>
              <Badge tone="info">1 / 2</Badge>
            </CardHeader>
            <CardBody>
              <VerificationGate user={DEMO_USER_PHONE_ONLY}>
                <SampleProtectedChild />
              </VerificationGate>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-navy">
                3. Phone + identity verified (wallet missing)
              </h3>
              <Badge tone="info">2 / 3</Badge>
            </CardHeader>
            <CardBody>
              <VerificationGate user={DEMO_USER_FULLY_VERIFIED} requireWallet>
                <SampleProtectedChild />
              </VerificationGate>
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-navy">
                4. Fully verified (including wallet)
              </h3>
              <Badge tone="success">3 / 3</Badge>
            </CardHeader>
            <CardBody>
              <VerificationGate user={DEMO_USER_WITH_WALLET} requireWallet>
                <SampleProtectedChild />
              </VerificationGate>
            </CardBody>
          </Card>
        </div>
      </section>
    </div>
  );
}
