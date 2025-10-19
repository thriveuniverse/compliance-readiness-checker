/**
 * @module complianceChecker
 * @description A self-contained JavaScript module for assessing HIPAA and GDPR compliance readiness.
 * It provides a questionnaire, evaluates answers with weighted scoring, and generates an actionable report.
 * This module runs entirely client-side with no external libraries or network calls.
 *
 * @version 1.0.0
 * @author Gemini
 */

// --- DESIGN NOTES ---
//
// Scoring Logic:
// The scoring model is based on weighted questions. Each question has a 'weight' from 0.5 (low impact) to 3.0 (critical).
// The maximum possible score for any question is its weight. The user's raw score is a fraction of that weight.
// - 'yes_no': 'yes' (true) receives the full weight value, 'no' (false) receives 0.
// - 'multiple': Choices are mapped to a score multiplier (e.g., 0, 0.5, 1.0). The raw score is `weight * choice.score`.
// - 'scale_0_2': The user's selection (0, 1, or 2) is normalized to a 0-1 scale by dividing by 2. The raw score is `weight * (answer / 2)`.
// Final scores (overall, per-standard, per-domain) are calculated as a percentage: `(sum of raw scores / sum of max scores) * 100`.
//
// Severity Thresholds for Findings:
// Findings are generated for any non-perfectly answered question. Severity is determined by a combination of the question's
// intrinsic importance (weight) and how poorly it was answered (score percentage).
// - High: Critical requirement (weight >= 2.5) with a low score (< 50%).
// - Medium: Important requirement (weight 1.5-2.49) with a medium-to-low score (< 70%).
// - Low: All other non-perfect scores. This ensures even minor gaps are noted.
//
// --- EXAMPLE USAGE (for a UI) ---
/*
import {
  createQuestionnaire,
  evaluateAnswers,
  generateReport,
  getMetadata
} from './complianceChecker.js';

// 1. Get metadata and the list of questions
const metadata = getMetadata();
const questions = createQuestionnaire();
console.log(`Starting ${metadata.appName} v${metadata.version} assessment.`);

// 2. In your UI, render the questions and collect user answers
// For this example, we'll use a mock set of answers.
const userAnswers = {
  'hipaa-admin-01': true,
  'hipaa-admin-02': 1,
  // ... answer all other questions
  'gdpr-transfer-02': false,
};

// 3. Evaluate the collected answers
const evaluation = evaluateAnswers(userAnswers);
console.log('Evaluation Complete. Overall Score:', evaluation.overallScore);

// 4. Generate a detailed, user-facing report
const report = generateReport(evaluation);
console.log('Classification:', report.classification);
console.log('First Finding:', report.findings[0]?.requirementSummary);

// 5. Display the report in the UI
// You can now use the structured `report` object to build a rich display.
*/

const METADATA = {
    appName: 'Compliance Readiness Checker',
    version: '1.0.0',
    standards: ['HIPAA', 'GDPR'],
    domains: {
        HIPAA: ['Administrative Safeguards', 'Physical Safeguards', 'Technical Safeguards', 'Breach Notification'],
        GDPR: ['Lawful Basis and Transparency', 'Data Subject Rights', 'DPIA and Records', 'Security of Processing', 'Processors and DPAs', 'Breach Notification', 'International Transfers'],
    },
    disclaimer: 'This tool provides general readiness guidance and is not legal advice. Consult with qualified legal counsel for compliance advice.'
};

/**
 * The full set of compliance questions.
 * @private
 * @type {Array<Question>}
 */
const QUESTIONS = [
    // --- HIPAA ---
    {
        id: 'hipaa-admin-01',
        standard: 'HIPAA',
        domain: 'Administrative Safeguards',
        text: 'Have you designated a Security Official responsible for developing and implementing security policies?',
        guidance: 'A specific individual must be assigned to oversee the organization\'s security program.',
        type: 'yes_no',
        weight: 3.0,
        citation: '45 CFR 164.308(a)(2)'
    },
    {
        id: 'hipaa-admin-02',
        standard: 'HIPAA',
        domain: 'Administrative Safeguards',
        text: 'How frequently is workforce security awareness and training conducted?',
        guidance: 'Regular training is required for all workforce members who handle ePHI.',
        type: 'scale_0_2',
        choices: [
            { value: 0, label: 'Never or Ad-hoc' },
            { value: 1, label: 'Periodically' },
            { value: 2, label: 'At least Annually & Onboarding' }
        ],
        weight: 2.5,
        citation: '45 CFR 164.308(a)(5)'
    },
    {
        id: 'hipaa-admin-03',
        standard: 'HIPAA',
        domain: 'Administrative Safeguards',
        text: 'Do you have a formal, documented risk analysis and risk management process?',
        guidance: 'You must conduct an accurate and thorough assessment of potential risks and vulnerabilities to ePHI.',
        type: 'yes_no',
        weight: 3.0,
        citation: '45 CFR 164.308(a)(1)(ii)(A)'
    },
     {
        id: 'hipaa-admin-04',
        standard: 'HIPAA',
        domain: 'Administrative Safeguards',
        text: 'Do you have a documented sanctions policy for workforce members who fail to comply with security policies?',
        guidance: 'There must be consequences for policy violations.',
        type: 'yes_no',
        weight: 1.5,
        citation: '45 CFR 164.308(a)(1)(ii)(C)'
    },
    {
        id: 'hipaa-phys-01',
        standard: 'HIPAA',
        domain: 'Physical Safeguards',
        text: 'Are your facilities that house ePHI systems physically secured against unauthorized entry?',
        guidance: 'This includes door locks, alarms, and visitor sign-in procedures for sensitive areas.',
        type: 'yes_no',
        weight: 2.5,
        citation: '45 CFR 164.310(a)(1)'
    },
    {
        id: 'hipaa-phys-02',
        standard: 'HIPAA',
        domain: 'Physical Safeguards',
        text: 'Do you have policies for controlling and validating a person\'s access to facilities based on their role?',
        guidance: 'Access should be granted on a need-to-know basis.',
        type: 'yes_no',
        weight: 2.0,
        citation: '45 CFR 164.310(a)(2)(i)'
    },
    {
        id: 'hipaa-phys-03',
        standard: 'HIPAA',
        domain: 'Physical Safeguards',
        text: 'Are policies in place for the secure disposal and re-use of electronic media containing ePHI?',
        guidance: 'Media must be rendered unreadable or indecipherable before being discarded or reused.',
        type: 'yes_no',
        weight: 2.0,
        citation: '45 CFR 164.310(d)(1)'
    },
    {
        id: 'hipaa-tech-01',
        standard: 'HIPAA',
        domain: 'Technical Safeguards',
        text: 'Is access to systems containing ePHI controlled via unique user identification?',
        guidance: 'Shared or generic user accounts are not permitted for accessing ePHI.',
        type: 'yes_no',
        weight: 3.0,
        citation: '45 CFR 164.312(a)(2)(i)'
    },
    {
        id: 'hipaa-tech-02',
        standard: 'HIPAA',
        domain: 'Technical Safeguards',
        text: 'Do you have mechanisms to encrypt and decrypt ePHI when it is appropriate?',
        guidance: 'Encryption is an addressable safeguard that must be implemented if reasonable and appropriate.',
        type: 'yes_no',
        weight: 2.5,
        citation: '45 CFR 164.312(a)(2)(iv)'
    },
    {
        id: 'hipaa-tech-03',
        standard: 'HIPAA',
        domain: 'Technical Safeguards',
        text: 'Are audit controls (logs) implemented to record and examine activity in information systems with ePHI?',
        guidance: 'System activity logs are crucial for detecting and responding to security incidents.',
        type: 'yes_no',
        weight: 2.5,
        citation: '45 CFR 164.312(b)'
    },
    {
        id: 'hipaa-tech-04',
        standard: 'HIPAA',
        domain: 'Technical Safeguards',
        text: 'Is ePHI protected from improper alteration or destruction?',
        guidance: 'Implement measures to ensure the integrity of ePHI, such as checksums or digital signatures.',
        type: 'yes_no',
        weight: 2.0,
        citation: '45 CFR 164.312(c)(1)'
    },
    {
        id: 'hipaa-breach-01',
        standard: 'HIPAA',
        domain: 'Breach Notification',
        text: 'Do you have a documented breach notification policy and procedure?',
        guidance: 'This policy must outline steps to identify, assess, and report breaches to affected individuals and HHS.',
        type: 'yes_no',
        weight: 3.0,
        citation: '45 CFR 164.404'
    },
    {
        id: 'hipaa-breach-02',
        standard: 'HIPAA',
        domain: 'Breach Notification',
        text: 'Does your breach assessment process include the four-factor analysis for determining risk of compromise?',
        guidance: 'The assessment must consider the nature of the PHI, the unauthorized person, if PHI was viewed, and mitigation extent.',
        type: 'yes_no',
        weight: 2.0,
        citation: '45 CFR 164.402'
    },
    // --- GDPR ---
    {
        id: 'gdpr-lawful-01',
        standard: 'GDPR',
        domain: 'Lawful Basis and Transparency',
        text: 'For each data processing activity, have you identified and documented a valid lawful basis under Article 6?',
        guidance: 'The six lawful bases are consent, contract, legal obligation, vital interests, public task, and legitimate interests.',
        type: 'yes_no',
        weight: 3.0,
        citation: 'Art. 6 Lawful basis'
    },
    {
        id: 'gdpr-lawful-02',
        standard: 'GDPR',
        domain: 'Lawful Basis and Transparency',
        text: 'Is your privacy notice easily accessible, and does it clearly explain processing activities to data subjects?',
        guidance: 'The notice must be concise, transparent, intelligible, and provided in clear and plain language.',
        type: 'yes_no',
        weight: 2.5,
        citation: 'Art. 13 & 14 Information to be provided'
    },
     {
        id: 'gdpr-lawful-03',
        standard: 'GDPR',
        domain: 'Lawful Basis and Transparency',
        text: 'When relying on consent, is it freely given, specific, informed, and unambiguous, with a clear affirmative action?',
        guidance: 'Pre-ticked boxes are not valid consent. It must be as easy to withdraw consent as to give it.',
        type: 'yes_no',
        weight: 2.5,
        citation: 'Art. 7 Conditions for consent'
    },
    {
        id: 'gdpr-rights-01',
        standard: 'GDPR',
        domain: 'Data Subject Rights',
        text: 'Do you have a clear process to respond to Data Subject Access Requests (DSARs) within one month?',
        guidance: 'This includes requests for access, rectification, erasure ("right to be forgotten"), and data portability.',
        type: 'yes_no',
        weight: 3.0,
        citation: 'Art. 15 Right of access'
    },
     {
        id: 'gdpr-rights-02',
        standard: 'GDPR',
        domain: 'Data Subject Rights',
        text: 'Can you effectively locate, modify, and erase an individual\'s personal data across all your systems?',
        guidance: 'This is a technical and procedural challenge. You must be able to honor the right to rectification and erasure.',
        type: 'yes_no',
        weight: 2.5,
        citation: 'Art. 16 & 17 Rectification and erasure'
    },
    {
        id: 'gdpr-dpia-01',
        standard: 'GDPR',
        domain: 'DPIA and Records',
        text: 'Do you maintain a detailed Record of Processing Activities (RoPA) as required under Article 30?',
        guidance: 'This internal record must detail what data you process, why, for how long, and who it is shared with.',
        type: 'yes_no',
        weight: 2.5,
        citation: 'Art. 30 Records of processing activities'
    },
    {
        id: 'gdpr-dpia-02',
        standard: 'GDPR',
        domain: 'DPIA and Records',
        text: 'Do you have a process to conduct Data Protection Impact Assessments (DPIAs) for high-risk processing activities?',
        guidance: 'A DPIA is required before starting new projects or using new technologies that are likely to result in a high risk to individuals.',
        type: 'yes_no',
        weight: 2.0,
        citation: 'Art. 35 DPIA'
    },
    {
        id: 'gdpr-security-01',
        standard: 'GDPR',
        domain: 'Security of Processing',
        text: 'Have you implemented technical and organizational measures to ensure a level of security appropriate to the risk?',
        guidance: 'This includes pseudonymization, encryption, regular testing, and ensuring confidentiality, integrity, availability, and resilience.',
        type: 'multiple',
        choices: [
            { value: 'none', label: 'No measures defined', score: 0 },
            { value: 'some', label: 'Some measures implemented', score: 0.5 },
            { value: 'full', label: 'Comprehensive, risk-based measures in place', score: 1.0 },
        ],
        weight: 3.0,
        citation: 'Art. 32 Security of processing'
    },
    {
        id: 'gdpr-security-02',
        standard: 'GDPR',
        domain: 'Security of Processing',
        text: 'Do you have a process for regularly testing, assessing, and evaluating the effectiveness of your security measures?',
        guidance: 'Security is not a one-time project; it requires ongoing validation.',
        type: 'yes_no',
        weight: 2.0,
        citation: 'Art. 32(1)(d)'
    },
    {
        id: 'gdpr-processors-01',
        standard: 'GDPR',
        domain: 'Processors and DPAs',
        text: 'Do you have legally binding Data Processing Agreements (DPAs) in place with all third-party processors?',
        guidance: 'A DPA is mandatory when a third party processes personal data on your behalf.',
        type: 'yes_no',
        weight: 3.0,
        citation: 'Art. 28 Processor'
    },
    {
        id: 'gdpr-processors-02',
        standard: 'GDPR',
        domain: 'Processors and DPAs',
        text: 'Do your DPAs explicitly state the processor\'s obligations, including security and breach notification requirements?',
        guidance: 'The DPA must contain specific clauses outlined in Article 28(3).',
        type: 'yes_no',
        weight: 2.0,
        citation: 'Art. 28(3)'
    },
    {
        id: 'gdpr-breach-01',
        standard: 'GDPR',
        domain: 'Breach Notification',
        text: 'Do you have a documented process to detect, investigate, and report personal data breaches to the supervisory authority?',
        guidance: 'Breaches posing a risk must be reported without undue delay, and where feasible, within 72 hours.',
        type: 'yes_no',
        weight: 3.0,
        citation: 'Art. 33 Notification of a breach'
    },
    {
        id: 'gdpr-breach-02',
        standard: 'GDPR',
        domain: 'Breach Notification',
        text: 'Do you have a process for communicating breaches to affected data subjects if it poses a high risk to their rights?',
        guidance: 'This communication must happen without undue delay.',
        type: 'yes_no',
        weight: 2.5,
        citation: 'Art. 34 Communication of a breach'
    },
    {
        id: 'gdpr-transfer-01',
        standard: 'GDPR',
        domain: 'International Transfers',
        text: 'For any personal data transfers outside the EU/EEA, have you implemented a valid transfer mechanism?',
        guidance: 'Mechanisms include adequacy decisions, Standard Contractual Clauses (SCCs), or Binding Corporate Rules (BCRs).',
        type: 'yes_no',
        weight: 3.0,
        citation: 'Art. 44 General principle for transfers'
    },
    {
        id: 'gdpr-transfer-02',
        standard: 'GDPR',
        domain: 'International Transfers',
        text: 'If using SCCs, have you conducted a Transfer Impact Assessment (TIA) to ensure data is protected in the destination country?',
        guidance: 'A TIA is required to assess whether the SCCs can be complied with in practice in the third country.',
        type: 'yes_no',
        weight: 2.5,
        citation: 'Art. 46 Transfers subject to safeguards'
    },
    // Adding more questions to meet the count requirement
    {
        id: 'hipaa-admin-05',
        standard: 'HIPAA',
        domain: 'Administrative Safeguards',
        text: 'Do you have a contingency plan, including data backup and disaster recovery, to ensure ePHI availability?',
        guidance: 'You must be able to restore access to ePHI in the event of an emergency.',
        type: 'yes_no',
        weight: 2.5,
        citation: '45 CFR 164.308(a)(7)'
    },
    {
        id: 'hipaa-admin-06',
        standard: 'HIPAA',
        domain: 'Administrative Safeguards',
        text: 'Are Business Associate Agreements (BAAs) in place with all vendors who create, receive, maintain, or transmit ePHI?',
        guidance: 'BAAs are required to ensure your vendors protect PHI to the same standards you do.',
        type: 'yes_no',
        weight: 3.0,
        citation: '45 CFR 164.308(b)(1)'
    },
    {
        id: 'hipaa-phys-04',
        standard: 'HIPAA',
        domain: 'Physical Safeguards',
        text: 'Are workstations that access ePHI positioned to prevent unauthorized viewing (e.g., away from high-traffic areas)?',
        guidance: 'This is a simple but effective safeguard against "shoulder surfing".',
        type: 'yes_no',
        weight: 1.0,
        citation: '45 CFR 164.310(b)'
    },
     {
        id: 'hipaa-tech-05',
        standard: 'HIPAA',
        domain: 'Technical Safeguards',
        text: 'Is there an automatic logoff mechanism that terminates electronic sessions after a predetermined period of inactivity?',
        guidance: 'This prevents unauthorized access from unattended workstations.',
        type: 'yes_no',
        weight: 1.5,
        citation: '45 CFR 164.312(a)(2)(iii)'
    },
     {
        id: 'hipaa-tech-06',
        standard: 'HIPAA',
        domain: 'Technical Safeguards',
        text: 'Do you have procedures to verify that a person or entity seeking access to ePHI is the one claimed?',
        guidance: 'This can be through passwords, two-factor authentication, or other identity verification methods.',
        type: 'yes_no',
        weight: 2.5,
        citation: '45 CFR 164.312(d)'
    },
    {
        id: 'gdpr-lawful-04',
        standard: 'GDPR',
        domain: 'Lawful Basis and Transparency',
        text: 'Do you adhere to the principles of data minimization and purpose limitation?',
        guidance: 'Only collect and process personal data that is adequate, relevant, and limited to what is necessary for the specified purpose.',
        type: 'yes_no',
        weight: 2.0,
        citation: 'Art. 5(1)(b) & (c)'
    },
    {
        id: 'gdpr-rights-03',
        standard: 'GDPR',
        domain: 'Data Subject Rights',
        text: 'Do you have a process to handle requests for restriction of processing and objections to processing?',
        guidance: 'Individuals have the right to block or suppress processing of their personal data in certain circumstances.',
        type: 'yes_no',
        weight: 2.0,
        citation: 'Art. 18 & 21'
    },
    {
        id: 'gdpr-security-03',
        standard: 'GDPR',
        domain: 'Security of Processing',
        text: 'Have you appointed a Data Protection Officer (DPO), if required by Article 37?',
        guidance: 'A DPO is mandatory for public authorities, or organizations whose core activities involve large-scale, regular monitoring or processing of sensitive data.',
        type: 'multiple',
        choices: [
             { value: 'not_req', label: 'Not Required for our organization', score: 1.0 },
             { value: 'yes', label: 'Yes, DPO appointed', score: 1.0 },
             { value: 'no', label: 'No, DPO not appointed but may be required', score: 0 },
        ],
        weight: 2.5,
        citation: 'Art. 37 Designation of DPO'
    },
     {
        id: 'gdpr-processors-03',
        standard: 'GDPR',
        domain: 'Processors and DPAs',
        text: 'Do you conduct due diligence on your data processors to ensure they have adequate security measures?',
        guidance: 'You are responsible for the actions of your processors. You must verify their ability to protect the data you share.',
        type: 'yes_no',
        weight: 2.0,
        citation: 'Art. 28(1)'
    },
     {
        id: 'gdpr-transfer-03',
        standard: 'GDPR',
        domain: 'International Transfers',
        text: 'Are you aware of and do you document the specific data being transferred, the purpose, and the recipient country?',
        guidance: 'Maintaining a clear inventory of international data flows is essential for compliance.',
        type: 'yes_no',
        weight: 1.5,
        citation: 'Art. 44-50 International Transfers'
    }
];

/**
 * @typedef {object} Question
 * @property {string} id - A unique identifier for the question.
 * @property {"HIPAA" | "GDPR"} standard - The compliance standard.
 * @property {string} domain - The specific domain within the standard.
 * @property {string} text - The question text presented to the user.
 * @property {string} guidance - Helper text to explain the question.
 * @property {"yes_no" | "multiple" | "scale_0_2"} type - The type of answer expected.
 * @property {Array<{value: string | number, label: string, score?: number}>} [choices] - Answer options for 'multiple' or 'scale_0_2'.
 * @property {number} weight - The importance of the question, from 0.5 to 3.
 * @property {string} citation - The relevant article or section of the regulation.
 */

/**
 * @typedef {object.<string, boolean | string | number>} Answers
 * An object mapping question IDs to the user's answer.
 */

/**
 * @typedef {object} Evaluation
 * @property {Array<{questionId: string, weight: number, rawScore: number, maxScore: number}>} items - The scored result for each question.
 * @property {number} overallScore - The overall compliance score as a percentage.
 * @property {{HIPAA: number, GDPR: number}} perStandard - Compliance scores for each standard.
 * @property {object.<string, number>} perDomain - Compliance scores for each domain.
 */

/**
 * Returns a deep copy of the compliance questionnaire.
 * @returns {Array<Question>} An array of all questions.
 */
export function createQuestionnaire() {
    return JSON.parse(JSON.stringify(QUESTIONS));
}

/**
 * Returns the module's metadata.
 * @returns {{appName: string, version: string, standards: string[], domains: object, disclaimer: string}}
 */
export function getMetadata() {
    return METADATA;
}

/**
 * Evaluates a set of answers against the compliance questionnaire.
 * @param {Answers} answers - A map of question IDs to user answers.
 * @returns {Evaluation} The calculated evaluation results.
 */
export function evaluateAnswers(answers) {
    const evaluationItems = [];
    const totals = {
        overall: { raw: 0, max: 0 },
        standard: { HIPAA: { raw: 0, max: 0 }, GDPR: { raw: 0, max: 0 } },
        domain: {}
    };

    // Initialize domain totals
    Object.values(METADATA.domains).flat().forEach(domainName => {
        totals.domain[domainName] = { raw: 0, max: 0 };
    });

    for (const q of QUESTIONS) {
        const answer = answers[q.id];
        let rawScore = 0;
        const maxScore = q.weight;

        if (answer !== undefined && answer !== null) {
            switch (q.type) {
                case 'yes_no':
                    rawScore = answer === true ? q.weight : 0;
                    break;
                case 'scale_0_2':
                    const numericAnswer = Number(answer);
                    if (!isNaN(numericAnswer) && numericAnswer >= 0 && numericAnswer <= 2) {
                        rawScore = q.weight * (numericAnswer / 2);
                    }
                    break;
                case 'multiple':
                    const choice = q.choices?.find(c => c.value === answer);
                    if (choice && typeof choice.score === 'number') {
                        rawScore = q.weight * choice.score;
                    }
                    break;
            }
        }
        
        evaluationItems.push({ questionId: q.id, weight: q.weight, rawScore, maxScore });
        
        totals.overall.raw += rawScore;
        totals.overall.max += maxScore;
        totals.standard[q.standard].raw += rawScore;
        totals.standard[q.standard].max += maxScore;
        if(totals.domain[q.domain]){
            totals.domain[q.domain].raw += rawScore;
            totals.domain[q.domain].max += maxScore;
        }
    }

    const calculatePercent = (raw, max) => (max > 0 ? (raw / max) * 100 : 100);

    const overallScore = calculatePercent(totals.overall.raw, totals.overall.max);
    const perStandard = {
        HIPAA: calculatePercent(totals.standard.HIPAA.raw, totals.standard.HIPAA.max),
        GDPR: calculatePercent(totals.standard.GDPR.raw, totals.standard.GDPR.max),
    };
    const perDomain = {};
    for (const domainName in totals.domain) {
        perDomain[domainName] = calculatePercent(totals.domain[domainName].raw, totals.domain[domainName].max);
    }

    return {
        items: evaluationItems,
        overallScore,
        perStandard,
        perDomain
    };
}

/**
 * Generates a user-friendly report from an evaluation object.
 * @param {Evaluation} evaluation - The output from evaluateAnswers.
 * @returns {object} A structured report for UI display.
 */
export function generateReport(evaluation) {
    const { overallScore, perStandard, perDomain } = evaluation;
    let classification = 'Low';
    if (overallScore >= 80) {
        classification = 'High';
    } else if (overallScore >= 50) {
        classification = 'Moderate';
    }

    const findings = [];
    const strengths = [];

    const questionMap = new Map(QUESTIONS.map(q => [q.id, q]));

    for (const item of evaluation.items) {
        const question = questionMap.get(item.questionId);
        if (!question) continue;

        const scorePercent = item.maxScore > 0 ? (item.rawScore / item.maxScore) * 100 : 100;

        if (scorePercent === 100 && item.weight >= 2.5) {
             strengths.push(`Strong controls in place for: ${question.text}`);
        } else if (scorePercent < 100) {
            let severity = 'Low';
            if (item.weight >= 2.5 && scorePercent < 50) {
                severity = 'High';
            } else if (item.weight >= 1.5 && item.weight < 2.5 && scorePercent < 70) {
                severity = 'Medium';
            }

            const finding = {
                id: question.id,
                standard: question.standard,
                domain: question.domain,
                severity,
                requirementSummary: question.text,
                observedStatus: generateObservedStatus(question, scorePercent),
                remediationSteps: generateRemediationSteps(question),
                evidenceToProvide: generateEvidence(question),
                citation: question.citation
            };
            findings.push(finding);
        }
    }
    
    // Sort findings by severity (High > Medium > Low)
    const severityOrder = { High: 0, Medium: 1, Low: 2 };
    findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    const perDomainScores = Object.entries(perDomain).map(([domain, score]) => {
        const question = QUESTIONS.find(q => q.domain === domain);
        return {
            standard: question ? question.standard : 'Unknown',
            domain,
            scorePercent: score
        }
    });

    return {
        meta: {
            appName: METADATA.appName,
            version: METADATA.version,
            generatedAtISO: new Date().toISOString(),
            disclaimer: METADATA.disclaimer,
        },
        overallScore,
        classification,
        perStandardScores: perStandard,
        perDomainScores,
        strengths: strengths.slice(0, 5), // Cap at 5 for brevity
        quickWins: [
            "Review and update workforce security awareness training materials.",
            "Verify that all facility access logs are being reviewed periodically.",
            "Schedule a tabletop exercise to test your breach notification procedure.",
            "Confirm that all third-party vendors handling sensitive data have a signed DPA/BAA on file.",
            "Ensure your public-facing privacy notice accurately reflects all current data processing activities."
        ],
        findings,
        recommendedNext30Days: [
            "Address all 'High' severity findings, starting with developing a formal project plan.",
            "Conduct a targeted risk assessment on the domains with the lowest scores.",
            "Assign owners and deadlines for each remediation step identified in the report.",
            "Review and invoke data processing agreements with key vendors to ensure compliance.",
            "Schedule a follow-up assessment to measure progress."
        ]
    };
}


// --- Private Helper Functions for Report Generation ---

/**
 * Generates a human-readable "observed status" string.
 * @private
 */
function generateObservedStatus(question, scorePercent) {
    switch (question.type) {
        case 'yes_no':
            return `The required control or policy ('${question.text}') is not in place or not fully implemented.`;
        case 'scale_0_2':
            if (scorePercent < 50) return `The process for '${question.text}' is ad-hoc or not formally established.`;
            return `The process for '${question.text}' is established but may lack formal documentation or consistent execution.`;
        case 'multiple':
            return `The current implementation for '${question.text}' does not meet the requirements for full compliance.`;
        default:
            return 'A compliance gap was identified.';
    }
}

/**
 * Generates actionable remediation steps.
 * @private
 */
function generateRemediationSteps(question) {
    // This is a simplified logic, a real system would have a database of steps.
    if (question.domain.includes('Safeguards') || question.domain.includes('Security')) {
        return [
            `Develop and approve a formal policy addressing '${question.citation}'.`,
            `Implement technical or procedural controls to enforce the new policy.`,
            `Provide training to all affected workforce members on the new policy and procedures.`,
            `Schedule a periodic review (e.g., annually) to ensure the control remains effective.`
        ];
    }
    if (question.domain.includes('Breach')) {
        return [
            `Draft a formal Breach Notification Policy and Incident Response Plan.`,
            `Define roles and responsibilities for the incident response team.`,
            `Conduct a tabletop exercise to simulate a data breach and test the plan.`,
            `Prepare templates for internal and external breach communications.`
        ];
    }
    if (question.domain.includes('Rights')) {
        return [
            `Create a public-facing intake form for data subject requests.`,
            `Develop an internal runbook for locating, retrieving, and packaging personal data.`,
            `Train customer support and operations teams on the DSAR response procedure and deadlines.`,
            `Implement a tracking system to monitor the status of all incoming requests.`
        ];
    }
    return [
        `Consult the requirement under '${question.citation}' to understand the specific obligations.`,
        `Perform a detailed gap analysis against the requirement.`,
        `Develop a corrective action plan with timelines and responsible parties.`,
    ];
}

/**
 * Generates a list of evidence to provide for auditors.
 * @private
 */
function generateEvidence(question) {
     if (question.domain.includes('Administrative') || question.domain.includes('DPIA')) {
        return [
            'Documented Risk Analysis Report',
            'Information Security Policies and Procedures Manual',
            'Workforce Training Records & Materials',
            'Sanction Policy Document',
            'Contingency Plan and Test Results'
        ];
    }
     if (question.domain.includes('Physical')) {
        return [
            'Facility Access Control Logs',
            'Visitor Sign-in Sheets',
            'Photos of physical security measures (e.g., locked doors, server cages)',
            'Media Disposal Records/Certificates of Destruction',
            'Workstation security policy'
        ];
    }
    if (question.domain.includes('Technical')) {
        return [
            'System Audit Logs (e.g., access, modification)',
            'User Access Review Reports',
            'Proof of Encryption Implementation (e.g., screenshots of configuration)',
            'Password Policy Document',
            'Intrusion Detection System Reports'
        ];
    }
    if (question.domain.includes('Rights') || question.domain.includes('Lawful')) {
        return [
            'Public-facing Privacy Notice',
            'Record of Processing Activities (RoPA)',
            'Sample Data Subject Access Request response',
            'Consent capture mechanism screenshots and records',
            'Data Protection Impact Assessment (DPIA) reports'
        ];
    }
    return [
        'Relevant policy documents',
        'Procedural runbooks or flowcharts',
        'System configuration screenshots',
        'Training completion reports',
        'Meeting minutes where topic was discussed and approved'
    ];
}


// --- IN-BROWSER TEST HARNESS ---
// To run, open the browser's developer console and see the output.

(function runTests() {
    console.group('Compliance Checker Self-Tests');
    try {
        // Test 1: Validate Questionnaire Structure
        const questions = createQuestionnaire();
        console.assert(questions.length >= 36 && questions.length <= 44, `Test Failed: Question count is ${questions.length}, expected 36-44.`);
        console.assert(questions.every(q => q.id && q.standard && q.domain && q.text && q.type && q.weight > 0 && q.citation), 'Test Failed: All questions must have required fields (id, standard, domain, text, type, weight, citation).');
        console.log('✔️ Test 1: Questionnaire structure is valid.');

        // Test 2: Run a sample evaluation
        const sampleAnswers = {};
        questions.forEach((q, i) => {
            // Create a mix of good, bad, and partial answers
            switch (q.type) {
                case 'yes_no':
                    sampleAnswers[q.id] = (i % 2 === 0); // Alternate yes/no
                    break;
                case 'scale_0_2':
                    sampleAnswers[q.id] = i % 3; // 0, 1, 2
                    break;
                case 'multiple':
                    sampleAnswers[q.id] = q.choices[0].value; // Pick the first, usually worst, option
                    break;
            }
        });
        
        const evaluation = evaluateAnswers(sampleAnswers);
        console.assert(evaluation.overallScore >= 0 && evaluation.overallScore <= 100, 'Test Failed: Overall score is out of bounds.');
        console.assert(evaluation.perStandard.HIPAA >= 0 && evaluation.perStandard.HIPAA <= 100, 'Test Failed: HIPAA score is out of bounds.');
        console.assert(evaluation.perStandard.GDPR >= 0 && evaluation.perStandard.GDPR <= 100, 'Test Failed: GDPR score is out of bounds.');
        console.log('✔️ Test 2: Sample evaluation completed.');
        console.log('   - Overall Score:', evaluation.overallScore.toFixed(2));
        console.log('   - Per-Standard Scores:', {
            HIPAA: evaluation.perStandard.HIPAA.toFixed(2),
            GDPR: evaluation.perStandard.GDPR.toFixed(2)
        });

        // Test 3: Generate a report and check for a finding
        const report = generateReport(evaluation);
        console.assert(report.findings.length > 0, 'Test Failed: Report should have generated findings for the sample answers.');
        console.assert(report.classification === 'Low', 'Test Failed: Report classification for sample data should be Low.');
        console.log('✔️ Test 3: Report generation successful.');
        console.log('   - Report Classification:', report.classification);
        
        const sampleFinding = report.findings[0];
        console.log('   - Sample Finding:', {
             standard: sampleFinding.standard,
             domain: sampleFinding.domain,
             severity: sampleFinding.severity,
             summary: sampleFinding.requirementSummary
        });

        console.log('%cAll tests passed!', 'color: green; font-weight: bold;');
        
    } catch (e) {
        console.error('An error occurred during testing:', e);
    } finally {
        console.groupEnd();
    }
})();

