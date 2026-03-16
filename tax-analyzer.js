const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `You are a knowledgeable tax assistant. Given the taxpayer's financial data, provide:
1. Total income across all sources
2. Estimated federal tax owed or refund based on current tax brackets
3. For any 1099-B data, calculate total capital gains and note whether they are short-term (taxed as ordinary income) or long-term (lower tax rate)
4. Total tax already withheld vs estimated amount owed
5. Any deductions or credits they may be missing
6. Two or three specific questions they should ask a CPA before filing
Always remind the user this is an estimate only and not official tax advice.`;

// MOCK MODE: set to false and add API credits at console.anthropic.com to use the real Claude API
const MOCK_MODE = true;

function mockAnalysis(organizedData) {
  const d = organizedData;
  const $ = (v) => v != null ? `$${v.toFixed(2)}` : 'N/A';
  const lines = [`Document extracted successfully — ${d.type}`,''];

  if (d.type === 'W-2') {
    lines.push(`Employer:                  ${d.employerName || 'Unknown'}`);
    lines.push(`Wages (Box 1):             ${$(d.wages)}`);
    lines.push(`Federal tax withheld (Box 2): ${$(d.federalTaxWithheld)}`);
    lines.push(`Social Security withheld:  ${$(d.socialSecurityTaxWithheld)}`);
    lines.push(`Medicare withheld:         ${$(d.medicareTaxWithheld)}`);
    if (d.stateTaxWithheld) lines.push(`State tax withheld:        ${$(d.stateTaxWithheld)}`);
  } else if (d.type === '1099-NEC') {
    lines.push(`Payer:                     ${d.payerName || 'Unknown'}`);
    lines.push(`Nonemployee compensation:  ${$(d.nonemployeeCompensation)}`);
  } else if (d.type === '1099-INT') {
    lines.push(`Payer:                     ${d.payerName || 'Unknown'}`);
    lines.push(`Interest income:           ${$(d.interestIncome)}`);
  } else if (d.type === '1099-DIV') {
    lines.push(`Payer:                     ${d.payerName || 'Unknown'}`);
    lines.push(`Ordinary dividends:        ${$(d.ordinaryDividends)}`);
    lines.push(`Qualified dividends:       ${$(d.qualifiedDividends)}`);
  } else if (d.type === '1099-B') {
    lines.push(`Broker:                    ${d.brokerName || 'Unknown'}`);
    lines.push(`Proceeds:                  ${$(d.proceeds)}`);
    lines.push(`Cost basis:                ${$(d.costBasis)}`);
    lines.push(`Net gain/loss:             ${$(d.netGainLoss)}`);
  }

  lines.push('', 'Document saved. Scroll down to calculate your tax return.');
  return lines.join('\n');
}

async function analyzeTaxData(organizedData) {
  if (MOCK_MODE) {
    return mockAnalysis(organizedData);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set.');
  }

  const client = new Anthropic({ apiKey });

  const userMessage = `Please analyze the following tax document data and provide a plain-English summary:\n\n${JSON.stringify(organizedData, null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock ? textBlock.text : '';
}

module.exports = { analyzeTaxData };
