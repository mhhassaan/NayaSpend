import { LegalDocument } from "../components/LegalDocument";

export function Privacy() {
  return <LegalDocument title="Privacy Policy" lead="Connecting an inbox is personal. Here is what this companion asks for, why it needs it, and how you stay in control." sections={[
    { id: "overview", title: "Your spending story stays yours", content: <>
      <p>This policy covers the information NayaSpend collects when you connect Gmail, import a CSV statement or enter transactions manually. It explains the purposes, storage and controls for that information.</p>
    </> },
    { id: "gmail", title: "What connecting Gmail allows", content: <>
      <p>With your explicit OAuth consent, NayaSpend requests the Gmail read-only scope (https://www.googleapis.com/auth/gmail.readonly). This permission can technically read mailbox messages; NayaSpend uses it only to find and parse transaction emails, not to browse unrelated personal conversations.</p>
      <p>Read-only means it cannot send, modify or delete email. Transaction details parsed from matching emails include vendor, amount, date and category. The connection also needs OAuth authorization tokens to maintain the access you approved. You never give NayaSpend your Gmail password.</p>
    </> },
    { id: "data", title: "The other data you bring", content: <>
      <p>CSV uploads provide statement transaction data, including vendor or description, amount and date, with categories added or adjusted in the app. Manually logged transactions contain the vendor, amount, date and category you enter, plus any notes you choose to add.</p>
      <p>Your account uses basic sign-in details, such as your name, email address and account identifier. The app also stores your category choices, budgets and preferences so your spending view is there when you return. Avoid adding sensitive information that a spending record does not need.</p>
    </> },
    { id: "purpose", title: "Why this information is needed", content: <>
      <p>Transaction records power categorization, category budgets, spending totals and trends. Your corrections help keep your own records useful. Account details connect those records to you, and OAuth tokens let the app fetch transaction emails while permission remains active.</p>
      <p>CSV imports and manual entries fill in the spending that email capture misses. You choose which sources to use.</p>
    </> },
    { id: "storage", title: "How your information is kept", content: <>
      <p>Your account details, connection tokens and spending records are stored securely to provide the service. Access is limited to what is needed to operate and maintain your account. No method of storage is completely risk-free, so please protect your Google account and devices too.</p>
      <p>Records are kept while you use the account, unless you delete them sooner. Deletion removes stored account and spending data; any residual backup copies should expire through routine backup rotation. This policy does not promise a specific storage provider, backup schedule or deletion deadline.</p>
    </> },
    { id: "sharing", title: "No selling. No sharing.", content: <>
      <p>Your spending data is never sold or shared with third parties. There is no advertising use, data marketplace, profiling for others, training of general-purpose AI models or sharing with NayaPay. Connecting Gmail authorizes reading transaction emails; it does not authorize sharing your spending history.</p>
      <p>Google handles your sign-in and permission choices under its own policies. NayaSpend's use of information received from Google APIs follows the Google API Services User Data Policy, including its Limited Use requirements.</p>
    </> },
    { id: "control", title: "Disconnect or delete, on your terms", content: <>
      <p>You can revoke NayaSpend's permission in your Google Account's third-party connections settings. That stops future Gmail access. Revoking access does not erase transactions already imported, and deleting app records does not delete the original emails or bank statements.</p>
      <p>To remove stored spending data or your account, use the app's data controls or request deletion through the project's GitHub. See <a href="#contact">Questions are welcome</a> for private contact guidance.</p>
    </> },
    { id: "children", title: "A note about children", content: <>
      <p>NayaSpend is not directed at children under 13, or below the age at which they can consent to data processing where they live. I do not knowingly collect personal information from children.</p>
      <p>If you believe a child has provided personal data, contact me through the project's GitHub so I can look into it and remove the information.</p>
    </> },
    { id: "changes", title: "When this policy changes", content: <>
      <p>If the way NayaSpend handles data changes, this page will be updated with a new date. Material changes will be explained in the app before they take effect where practical. Any new permission will require your consent where required.</p>
      <p>You can review the updated policy, disconnect Gmail or delete your data whenever you choose.</p>
    </> },
    { id: "contact", title: "Questions are welcome", content: <>
      <p>For privacy questions, corrections, a copy of your records or deletion requests, contact me through the project's GitHub. Ask for a private contact route before sharing anything personal; never post statements, access tokens or account details publicly.</p>
    </> },
  ]} />;
}
