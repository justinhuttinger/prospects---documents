/**
 * The legal text for the WCS online-join acknowledgement step.
 *
 * Transcribed verbatim from ABC Fitness Solutions' standard
 * "REQUEST FOR PREAUTHORIZED PAYMENT" + "Membership Privileges, Notices,
 * Disclosures & Agreements" pages (the two photos the user provided).
 * Wording is intentionally identical so the signed PDF that ends up in
 * the member's ABC document folder reads the same as the legacy paper
 * agreement.
 *
 * Two exported helpers:
 *   agreementBodyHtml()    — the legal-text block alone. Rendered both
 *                            in the widget acknowledgement step and inside
 *                            the PDF.
 *   buildSignedPdfHtml({signup, plan, location, signatureDataUrl})
 *                          — full PDF document HTML (header, fill-in
 *                            fields, agreement body, signature block).
 *                            Fed to PDFShift to render the final PDF.
 */

function agreementBodyHtml() {
  return `
    <section class="wcs-agreement-section">
      <h3>Request For Preauthorized Payment</h3>
      <p>
        I/We hereby request the privilege of paying to ABC Fitness Solutions,
        LLC ("The Company"), Sherwood, AR 72124, and further authorize the
        Company to draw items (checks, electronic fund transfers, charge card)
        for the purpose of paying said payments, including any late fees or
        service fees, on the account listed above. Subject to the following
        conditions:
      </p>
      <ol class="wcs-agreement-ol">
        <li>
          The items outlined in Your Membership Agreement (monthly dues, annual
          fees, enrollment fees, etc.) shall be drawn on or about the date or
          dates set forth in the Membership Agreement. By signing below, You
          authorize the Company to draft via EFT said amounts from the account
          or card identified herein. The transactions on Your bank, debit, or
          credit card statement shall constitute receipts for payment on Your
          account.
        </li>
        <li>
          <strong>One-Time Transfers:</strong> When You provide a check as
          payment, You authorize the Company either to use information from
          Your check to make a one-time EFT from Your account or to process the
          payment as a check transaction. When the Company uses information
          from Your check to make an electronic fund transfer, funds may be
          withdrawn from Your account as soon as today's date.
        </li>
        <li>
          If the regular payments set forth in the Membership Agreement should
          vary in amount, You are entitled to notice at least 10 days before
          each payment of when it will be made and how much it will be.
          However, by executing this preauthorization, You choose to instead
          get this notice only when the payment would differ by more than
          $50.00 from the most recent payment You have made.
        </li>
        <li>
          By executing this Agreement, You acknowledge Your awareness that
          certain disclosures required by the Electronic Funds Transfer Act
          and its regulations are available for Your review at the Company's
          website: www.abcfitness.com under Terms of Service.
        </li>
        <li>
          The privilege of making EFT payments under this arrangement may be
          revoked by the Company if any item is not paid upon presentation.
        </li>
        <li>
          If this preauthorization payment arrangement is revoked for any
          reason, this does not release You from Your obligation under Your
          Membership Agreement.
        </li>
        <li>
          If any payment is not paid upon presentation to Your bank or
          credit/debit card company for any reason, a service fee will be
          assessed and drafted. A late fee will be assessed and drafted
          should any monthly payment become past due.
        </li>
        <li>
          By executing this Agreement, You authorize Club and Club's agents,
          including its third party payment processing companies ("Club's
          Agents"), to store the account or card information provided by You
          on or in relation to this Agreement and/or Your Club Membership
          Agreement ("Club Agreement"), as well as any other account or card
          information provided by You through any means to Club or Club's
          Agents (including information provided in person, online or over the
          phone) for purposes of making any payment in relation to this
          Agreement and/or Your Club Agreement (hereinafter, "Payment
          Information"). Club and/or Club's Agents will use the stored Payment
          Information to process payment of all dues, fees, taxes, purchases
          and incidental charges that are due or will become due, including
          all items on the Payment Schedule, fees identified in Your Club
          Agreement, membership-related obligations, retail transactions,
          personal training purchases, group exercise purchases, childcare
          fees, or other purchases. Club and/or Club's Agents may also use the
          stored Payment Information to process payments owed in relation to
          all subsequent Agreements entered between You and Club. The fixed
          dates or intervals on which transactions will be processed and the
          transaction amounts (including all associated fees, taxes, and
          charges) and/or a description of how they will be calculated are
          more specifically set forth in the Payment Schedule and other terms
          of Your Club Agreement. If Your Club Agreement will automatically
          renew at the end of the Term defined therein, the stored Payment
          Information will be used to process payments owed in relation to
          the renewal term. This consent to store Payment Information will
          not expire unless it is expressly revoked. The general cancellation
          and refund policies provided in Your Club Agreement will apply to
          this consent. If any changes are made to the terms of this consent,
          an e-mail notifying You of such changes will be sent to the e-mail
          address provided by You on the face of Your Club Agreement or, if
          an e-mail is not provided, notice will be sent to the mailing
          address provided on Your Club Agreement.
        </li>
        <li>
          This preauthorization payment arrangement shall apply to the
          following Applicant(s): the member named in the signature block
          below.
        </li>
      </ol>

      <p class="wcs-agreement-note">
        The Federal Equal Credit Opportunity Act prohibits creditors from
        discriminating against credit applicants on the basis of sex or
        marital status. The agency that administers compliance with the law
        is the Federal Trade Commission, Equal Credit Opportunity,
        Washington, D.C. 20580.
      </p>
    </section>

    <section class="wcs-agreement-section">
      <h3>Membership Privileges, Notices, Disclosures &amp; Agreements</h3>

      <p>
        <strong>DEFAULT AND LATE PAYMENTS:</strong> Should you default on any
        payment obligation as called for in this agreement, the club will have
        the right to declare the entire remaining balance due and payable and
        you agree to pay allowable interest, and all costs of collection,
        including but not limited to collection agency fees, court costs, and
        attorney fees. A default occurs when any payment due under this
        agreement is more than ten days late. <strong>A SERVICE FEE WILL BE
        CHARGED IMMEDIATELY FOR ANY CHECK, DRAFT, CREDIT CARD, OR ORDER
        RETURNED FOR INSUFFICIENT FUNDS OR ANY OTHER REASON. SHOULD ANY
        MONTHLY PAYMENT BECOME MORE THAN TEN DAYS PAST DUE, YOU WILL BE
        CHARGED A LATE FEE.</strong> If the Member is paying monthly dues by
        electronic funds transfer (EFT), the club's billing company, ABC
        Fitness Solutions, LLC, reserves the right to draft via EFT all
        amounts owed by the member including any and all late fees and
        service fees. Subject to appropriate State and Federal Law.
        <strong>NOTE: Members paying monthly dues by EFT are subject to
        $10.00 per month increase of monthly dues if EFT payment is stopped
        or changed. This will not affect any other provisions of this
        agreement.</strong>
      </p>

      <p>
        Notwithstanding any other provisions of this Agreement, you
        understand and agree that the amount of your monthly membership dues
        is based on current sales tax rates and to the extent such rates
        should increase during your membership, the club has the right to
        increase your monthly membership dues by the amount of such increase.
        If you have requested the privilege of paying your monthly dues by
        pre-authorized electronic funds transfer, the monthly amount so
        transferred will be adjusted to reflect any increase in the sales
        tax rate.
      </p>
    </section>

    <section class="wcs-agreement-section">
      <h3>Renewal Program Options</h3>

      <p>
        <strong>MONTH TO MONTH AGREEMENT:</strong> The member agrees to make
        the Scheduled Payments according to the terms set forth by this
        agreement. This agreement may be cancelled at any time with a 30 day
        written notice delivered to the club's address, after the first 30
        days of membership is completed. The member will be required to make
        any Scheduled Payments that are due within the 30 day notice to
        cancel.
      </p>

      <p>
        <strong>TERM AGREEMENT AUTOMATIC RENEWAL PROGRAM:</strong> Provided
        the Member is not in default of this agreement and subject to the
        terms and conditions hereof, the membership will automatically renew
        at the rate indicated, on the indicated date. Cancellation of
        Renewal and/or any additional Payment Schedules set forth by this
        agreement will require a 30-day written notice delivered to the
        club's address. The member will be required to make payments that
        are due within the 30 day notice to cancel. This agreement has an
        indicated month term obligation that must be fulfilled prior to
        cancellation in order to avoid any early cancellation fees.
      </p>

      <p>
        <strong>PAID IN FULL or NON-RENEWAL:</strong> This is a
        non-transferable membership that will expire on the term obligation
        date.
      </p>

      <p>
        An <strong>Annual Facility Fee</strong> of the indicated amount will
        be billed on the indicated date and each year thereafter.
      </p>

      <p>
        <strong>FAMILY ADD ON RATE NOTICE:</strong> I understand that I am
        joining at a reduced rate as a family add-on to an existing Master
        Member. I understand that should my "Master" member become inactive
        during the course of my membership, my monthly dues payments are
        subject to increase to the current single membership rate.
      </p>

      <p class="wcs-agreement-note">
        <strong>NOTICE:</strong> ANY HOLDER OF THIS AGREEMENT IS SUBJECT TO
        ALL CLAIMS AND DEFENSES WHICH THE DEBTOR COULD ASSERT AGAINST THE
        SELLER OF GOODS OR SERVICES OBTAINED PURSUANT HERETO OR WITH THE
        PROCEEDS HEREOF, RECOVERY HEREUNDER BY THE DEBTOR SHALL NOT EXCEED
        AMOUNTS PAID BY THE DEBTOR HEREUNDER.
      </p>
    </section>
  `;
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(n) {
  if (n == null || n === '') return '$0.00';
  const num = Number(n);
  return Number.isFinite(num) ? `$${num.toFixed(2)}` : `$${n}`;
}

/**
 * Build the full HTML document that gets POSTed to PDFShift to render the
 * signed-agreement PDF. The PDF ends up on the member's ABC document tab.
 *
 * Inputs:
 *   signup           — online_signups row (must have abc_member_id by this point)
 *   plan             — online_join_plans row (label, today_amount, monthly_amount)
 *   location         — online_join_locations row (display_name, address, abc_club_number)
 *   signatureDataUrl — "data:image/png;base64,..." from the canvas pad
 *   typedSignature   — printed name the member typed
 *   signedAt         — ISO timestamp
 */
function buildSignedPdfHtml({ signup, plan, location, signatureDataUrl, typedSignature, signedAt }) {
  const memberName = `${signup.first_name || ''} ${signup.last_name || ''}`.trim();
  const sigImg = (typeof signatureDataUrl === 'string' && signatureDataUrl.startsWith('data:image/'))
    ? signatureDataUrl
    : null;
  const dateStr = signedAt ? new Date(signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }) : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>WCS Online Join Agreement</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @page { margin: 0.6in; size: letter; }
  body { font-family: 'Inter', Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: #0a0a0c; }
  .pdf-header {
    border-bottom: 3px solid #e31837;
    padding-bottom: 12px; margin-bottom: 18px;
    display: flex; justify-content: space-between; align-items: flex-end;
  }
  .pdf-title {
    font-family: 'Bebas Neue', Impact, sans-serif;
    font-size: 28pt; letter-spacing: 0.04em;
    text-transform: uppercase; line-height: 1;
    color: #0a0a0c;
  }
  .pdf-eyebrow {
    font-size: 8pt; font-weight: 700;
    letter-spacing: 0.22em; text-transform: uppercase;
    color: #e31837; margin-bottom: 4px;
  }
  .pdf-club {
    text-align: right; font-size: 9pt;
  }
  .pdf-club strong { display: block; font-size: 11pt; color: #0a0a0c; }
  .pdf-meta {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px;
    margin-bottom: 18px;
    padding: 12px 14px;
    background: #f6f6f4;
    font-size: 9pt;
  }
  .pdf-meta dt {
    font-weight: 700;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: #6b6b73; font-size: 7.5pt;
  }
  .pdf-meta dd { margin: 0 0 6px; color: #0a0a0c; }
  h3 {
    font-family: 'Bebas Neue', Impact, sans-serif;
    font-size: 14pt; letter-spacing: 0.04em;
    text-transform: uppercase;
    margin: 22px 0 8px;
    color: #0a0a0c;
  }
  ol.wcs-agreement-ol {
    padding-left: 18px; margin: 8px 0 12px;
  }
  ol.wcs-agreement-ol li { margin-bottom: 8px; text-align: justify; }
  p { margin: 0 0 10px; text-align: justify; }
  .wcs-agreement-note {
    font-size: 8.5pt;
    background: #fafaf8;
    border-left: 3px solid #0a0a0c;
    padding: 8px 12px;
    margin-top: 12px;
  }
  .pdf-sig {
    margin-top: 28px;
    border-top: 2px solid #0a0a0c;
    padding-top: 16px;
  }
  .pdf-sig-grid {
    display: grid;
    grid-template-columns: 2fr 1fr;
    gap: 24px;
    align-items: flex-end;
  }
  .pdf-sig-box {
    border: 1px solid #ececea;
    background: #fff;
    height: 110px;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .pdf-sig-box img { max-width: 100%; max-height: 100%; }
  .pdf-sig-label {
    font-size: 7.5pt; font-weight: 700;
    letter-spacing: 0.22em; text-transform: uppercase;
    color: #6b6b73; margin-top: 6px;
  }
  .pdf-sig-name {
    font-family: 'Bebas Neue', Impact, sans-serif;
    font-size: 18pt; line-height: 1; letter-spacing: 0.02em;
    color: #0a0a0c; margin-bottom: 4px;
  }
  .pdf-footer {
    margin-top: 24px; padding-top: 10px;
    border-top: 1px solid #ececea;
    font-size: 7.5pt; color: #6b6b73;
    text-align: center;
  }
</style></head><body>

  <div class="pdf-header">
    <div>
      <div class="pdf-eyebrow">West Coast Strength · Online Join</div>
      <div class="pdf-title">Membership Agreement</div>
    </div>
    <div class="pdf-club">
      <strong>${escapeHtml(location?.display_name || '')}</strong>
      ${location?.address_line1 ? `${escapeHtml(location.address_line1)}<br>` : ''}
      ${[location?.city, location?.state, location?.zip].filter(Boolean).map(escapeHtml).join(', ')}<br>
      Club #${escapeHtml(location?.abc_club_number || signup.abc_club_number || '')}
    </div>
  </div>

  <dl class="pdf-meta">
    <div><dt>Member</dt><dd>${escapeHtml(memberName)}</dd></div>
    <div><dt>Email</dt><dd>${escapeHtml(signup.email || '')}</dd></div>
    <div><dt>Phone</dt><dd>${escapeHtml(signup.cell_phone || '')}</dd></div>
    <div><dt>Date of Birth</dt><dd>${escapeHtml(signup.birthday || '')}</dd></div>
    <div><dt>Address</dt><dd>${escapeHtml(signup.address_line1 || '')}${signup.address_line2 ? ', ' + escapeHtml(signup.address_line2) : ''}, ${escapeHtml(signup.city || '')}, ${escapeHtml(signup.state || '')} ${escapeHtml(signup.zip_code || '')}</dd></div>
    <div><dt>Plan</dt><dd>${escapeHtml(plan?.plan_label || '')}</dd></div>
    <div><dt>Due Today</dt><dd>${money(plan?.today_amount)}</dd></div>
    <div><dt>Monthly Dues</dt><dd>${money(plan?.monthly_amount)}</dd></div>
    <div><dt>Member ID</dt><dd>${escapeHtml(signup.abc_member_id || '')}</dd></div>
    <div><dt>Agreement #</dt><dd>${escapeHtml(signup.abc_agreement_id || '')}</dd></div>
  </dl>

  ${agreementBodyHtml()}

  <div class="pdf-sig">
    <div class="pdf-sig-grid">
      <div>
        <div class="pdf-sig-box">
          ${sigImg ? `<img src="${sigImg}" alt="Member signature">` : '<span style="color:#a0a0a8; font-size:9pt;">[no signature captured]</span>'}
        </div>
        <div class="pdf-sig-label">Member Signature</div>
      </div>
      <div>
        <div class="pdf-sig-name">${escapeHtml(typedSignature || memberName)}</div>
        <div class="pdf-sig-label">Printed Name</div>
        <div style="margin-top:14px;">
          <div class="pdf-sig-name" style="font-size:13pt;">${escapeHtml(dateStr)}</div>
          <div class="pdf-sig-label">Date Signed</div>
        </div>
      </div>
    </div>
  </div>

  <div class="pdf-footer">
    Generated by westcoaststrength.com online enrollment ·
    Member ID ${escapeHtml(signup.abc_member_id || '')} ·
    Agreement ${escapeHtml(signup.abc_agreement_id || '')}
  </div>

</body></html>`;
}

module.exports = { agreementBodyHtml, buildSignedPdfHtml };
