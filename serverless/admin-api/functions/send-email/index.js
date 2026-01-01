const AWS = require('aws-sdk');

const ses = new AWS.SES({ region: process.env.AWS_REGION || 'us-east-2' });

const SENDER_EMAIL = process.env.SENDER_EMAIL || 'noreply@aisol.cloud';
const COMPANY_NAME = 'AiSol';
const PLATFORM_URL = 'https://solar.aisol.cloud';

/**
 * Email templates for different notification types
 */
const templates = {
  projectCreated: (data) => ({
    subject: `${COMPANY_NAME} - Novo Projeto Criado: ${data.projectName}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }
    .project-card { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .project-name { font-size: 20px; font-weight: bold; color: #111827; margin-bottom: 10px; }
    .project-id { font-family: monospace; background: #f3f4f6; padding: 4px 8px; border-radius: 4px; font-size: 12px; color: #6b7280; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: bold; }
    .badge-prod { background: #dcfce7; color: #166534; }
    .badge-dev { background: #fef9c3; color: #854d0e; }
    .button { display: inline-block; background: #10b981; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 20px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Novo Projeto Criado</h1>
    </div>
    <div class="content">
      <p>Ola!</p>
      <p>Um novo projeto foi criado na plataforma ${COMPANY_NAME}:</p>

      <div class="project-card">
        <div class="project-name">${data.projectName}</div>
        ${data.description ? `<p style="color: #6b7280; margin: 10px 0;">${data.description}</p>` : ''}
        <p><strong>ID do Projeto:</strong> <span class="project-id">${data.projectId}</span></p>
        <p>
          <span class="badge ${data.environment === 'prod' ? 'badge-prod' : 'badge-dev'}">
            ${data.environment === 'prod' ? 'PRODUCAO' : 'DESENVOLVIMENTO'}
          </span>
        </p>
      </div>

      <p>O projeto esta aguardando o envio das imagens de drone para processamento.</p>

      <a href="${PLATFORM_URL}/projects/${data.projectId}" class="button">Ver Projeto</a>

      <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
        Se voce nao solicitou este projeto, por favor entre em contato conosco.
      </p>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${COMPANY_NAME}. Todos os direitos reservados.</p>
      <p>Este e um email automatico, por favor nao responda.</p>
    </div>
  </div>
</body>
</html>
    `,
    text: `
${COMPANY_NAME} - Novo Projeto Criado

Ola!

Um novo projeto foi criado na plataforma ${COMPANY_NAME}:

Nome: ${data.projectName}
${data.description ? `Descricao: ${data.description}` : ''}
ID: ${data.projectId}
Ambiente: ${data.environment === 'prod' ? 'PRODUCAO' : 'DESENVOLVIMENTO'}

O projeto esta aguardando o envio das imagens de drone para processamento.

Acesse: ${PLATFORM_URL}/projects/${data.projectId}

---
${COMPANY_NAME}
Este e um email automatico, por favor nao responda.
    `,
  }),

  projectReleased: (data) => ({
    subject: `${COMPANY_NAME} - Relatorio Pronto: ${data.projectName}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; font-size: 24px; }
    .content { background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; }
    .success-icon { font-size: 48px; margin-bottom: 10px; }
    .project-card { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .project-name { font-size: 20px; font-weight: bold; color: #111827; margin-bottom: 10px; }
    .project-id { font-family: monospace; background: #f3f4f6; padding: 4px 8px; border-radius: 4px; font-size: 12px; color: #6b7280; }
    .status-complete { color: #059669; font-weight: bold; }
    .button { display: inline-block; background: #10b981; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 20px; }
    .button-secondary { display: inline-block; background: #6b7280; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-top: 10px; margin-left: 10px; }
    .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
    .highlight { background: #dcfce7; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="success-icon">&#10004;</div>
      <h1>Relatorio Termografico Pronto!</h1>
    </div>
    <div class="content">
      <p>Otimas noticias!</p>

      <div class="highlight">
        <p style="margin: 0;"><strong>O relatorio termografico do seu projeto esta pronto para download!</strong></p>
      </div>

      <div class="project-card">
        <div class="project-name">${data.projectName}</div>
        <p><strong>ID do Projeto:</strong> <span class="project-id">${data.projectId}</span></p>
        <p><strong>Status:</strong> <span class="status-complete">Concluido</span></p>
        <p><strong>Liberado em:</strong> ${new Date().toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}</p>
      </div>

      <p>O relatorio inclui:</p>
      <ul>
        <li>Analise termografica completa</li>
        <li>Identificacao de defeitos</li>
        <li>Mapa de calor da instalacao</li>
        <li>Recomendacoes de manutencao</li>
      </ul>

      <a href="${PLATFORM_URL}/projects/${data.projectId}" class="button">Baixar Relatorio</a>

      <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">
        Se tiver alguma duvida sobre o relatorio, entre em contato com nossa equipe de suporte.
      </p>
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ${COMPANY_NAME}. Todos os direitos reservados.</p>
      <p>Este e um email automatico, por favor nao responda.</p>
    </div>
  </div>
</body>
</html>
    `,
    text: `
${COMPANY_NAME} - Relatorio Termografico Pronto!

Otimas noticias!

O relatorio termografico do seu projeto esta pronto para download!

Projeto: ${data.projectName}
ID: ${data.projectId}
Status: Concluido
Liberado em: ${new Date().toLocaleDateString('pt-BR')}

O relatorio inclui:
- Analise termografica completa
- Identificacao de defeitos
- Mapa de calor da instalacao
- Recomendacoes de manutencao

Acesse: ${PLATFORM_URL}/projects/${data.projectId}

---
${COMPANY_NAME}
Este e um email automatico, por favor nao responda.
    `,
  }),
};

/**
 * Send email notification
 */
async function sendEmail(to, templateName, data) {
  const template = templates[templateName];
  if (!template) {
    throw new Error(`Unknown template: ${templateName}`);
  }

  const { subject, html, text } = template(data);

  const params = {
    Destination: {
      ToAddresses: Array.isArray(to) ? to : [to],
    },
    Message: {
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: html,
        },
        Text: {
          Charset: 'UTF-8',
          Data: text,
        },
      },
      Subject: {
        Charset: 'UTF-8',
        Data: subject,
      },
    },
    Source: SENDER_EMAIL,
  };

  try {
    const result = await ses.sendEmail(params).promise();
    console.log(`Email sent successfully to ${to}`, { messageId: result.MessageId, template: templateName });
    return { success: true, messageId: result.MessageId };
  } catch (error) {
    console.error(`Failed to send email to ${to}`, { error: error.message, template: templateName });
    // Don't throw - we don't want email failures to break the main flow
    return { success: false, error: error.message };
  }
}

module.exports = { sendEmail, templates };

// Export handler for direct Lambda invocation if needed
exports.handler = async (event) => {
  const { to, template, data } = event;

  if (!to || !template || !data) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required fields: to, template, data' }),
    };
  }

  const result = await sendEmail(to, template, data);
  return {
    statusCode: result.success ? 200 : 500,
    body: JSON.stringify(result),
  };
};
