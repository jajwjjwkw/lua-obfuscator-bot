const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');
const LuaObfuscator = require('./lua-obfuscator');
const LuaDeobfuscator = require('./lua-deobfuscator');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
// AI: Groq (gratis 30req/min) oder OpenRouter als Fallback
const AI_KEY = process.env.GROQ_KEY || process.env.OPENROUTER_KEY || '';
const AI_TYPE = process.env.GROQ_KEY ? 'groq' : (process.env.OPENROUTER_KEY ? 'openrouter' : 'none');

if (!TOKEN || !CLIENT_ID) {
  console.error('Set DISCORD_TOKEN and CLIENT_ID env vars');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: ['CHANNEL'],
});

// Express for Railway/Render health checks (keeps 24/7 alive)
const PORT = process.env.PORT || 3000;
const app = express();
app.get('/', (_, res) => res.send('7cpxq Bot Online'));
app.get('/health', (_, res) => res.send('OK'));
app.listen(PORT, () => console.log('Health on port ' + PORT));

const commands = [
  new SlashCommandBuilder()
    .setName('obfuscate')
    .setDescription('Obfuscate a Lua script from a URL')
    .addStringOption(o => o.setName('url').setDescription('URL to the Lua script').setRequired(true)),
  new SlashCommandBuilder()
    .setName('deobfuscate')
    .setDescription('Deobfuscate a Lua script from a URL')
    .addStringOption(o => o.setName('url').setDescription('URL to the obfuscated Lua script').setRequired(true)),
  new SlashCommandBuilder()
    .setName('ai')
    .setDescription('Ask AI to generate a Lua script')
    .addStringOption(o => o.setName('prompt').setDescription('Describe what Lua script you want').setRequired(true)),
].map(c => c.toJSON());

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

function normalizeUrl(raw) {
  let url = raw.trim();
  const gist = url.match(/gist\.github\.com\/[^\/]+\/([a-f0-9]+)/);
  if (gist) return 'https://gist.githubusercontent.com/raw/' + gist[1];
  if (url.includes('github.com') && url.includes('/blob/'))
    return url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
  if (url.includes('pastefy')) {
    url = url.replace(/\/+$/, '');
    if (!url.endsWith('/raw')) url += '/raw';
    return url;
  }
  const pb = url.match(/pastebin\.com\/([a-zA-Z0-9]+)/);
  if (pb) return 'https://pastebin.com/raw/' + pb[1];
  const hb = url.match(/hastebin\.(?:com|swe)\.co\/(?:raw\/)?([a-zA-Z0-9]+)/);
  if (hb) return 'https://hastebin.swe.co/raw/' + hb[1];
  return url;
}

async function fetchScript(rawUrl) {
  const url = normalizeUrl(rawUrl);
  console.log('Fetching:', url);
  const res = await axios.get(url, {
    timeout: 60000,
    maxContentLength: 10 * 1024 * 1024,
    maxBodyLength: 10 * 1024 * 1024,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 7cpxqBot/2.0)', 'Accept': 'text/plain, */*' },
    responseType: 'text',
    transformResponse: [(d) => d],
    validateStatus: () => true,
  });
  const data = typeof res.data === 'string' ? res.data : String(res.data);
  if (!data || data.length < 3) throw new Error('Empty or too short');
  return data;
}

function buildBanner(isObf) {
  return isObf
    ? '```ansi\n\u001b[1;31m' +
      '  ██████╗ ██████╗ ███████╗██╗   ██╗███████╗ ██████╗ █████╗ ████████╗███████╗██████╗ \n' +
      '  ██╔═══██╗██╔══██╗██╔════╝██║   ██║██╔════╝██╔════╝██╔══██╗╚══██╔══╝██╔════╝██╔══██╗\n' +
      '  ██║   ██║██████╔╝█████╗  ██║   ██║███████╗██║     ███████║   ██║   █████╗  ██║  ██║\n' +
      '  ██║   ██║██╔══██╗██╔══╝  ██║   ██║╚════██║██║     ██╔══██║   ██║   ██╔══╝  ██║  ██║\n' +
      '  ╚██████╔╝██████╔╝███████╗╚██████╔╝███████║╚██████╗██║  ██║   ██║   ███████╗██████╔╝\n' +
      '   ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═════╝ \n' +
      '\u001b[0m'
    : '```ansi\n\u001b[1;32m' +
      '  ██████╗ ███████╗ ██████╗ ██████╗ ███████╗██╗   ██╗███████╗ ██████╗ █████╗ ████████╗███████╗██████╗ \n' +
      '  ██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝██║   ██║██╔════╝██╔════╝██╔══██╗╚══██╔══╝██╔════╝██╔══██╗\n' +
      '  ██║  ██║█████╗  ██║   ██║██████╔╝█████╗  ██║   ██║███████╗██║     ███████║   ██║   █████╗  ██║  ██║\n' +
      '  ██║  ██║██╔══╝  ██║   ██║██╔══██╗██╔══╝  ██║   ██║╚════██║██║     ██╔══██║   ██║   ██╔══╝  ██║  ██║\n' +
      '  ██████╔╝███████╗╚██████╔╝██████╔╝██║     ╚██████╔╝███████║╚██████╗██║  ██║   ██║   ███████╗██████╔╝\n' +
      '   ╚═════╝ ╚══════╝ ╚═════╝ ╚═════╝ ╚═╝      ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═════╝ \n' +
      '\u001b[0m';
}

async function sendDM(interaction, result, label, sourceUrl) {
  const dm = await interaction.user.createDM().catch(() => null);
  if (!dm) {
    await interaction.editReply({ content: 'Unable to open DMs. Enable DMs from server members.' });
    return false;
  }

  const filename = label + '_' + Date.now() + '.lua';
  const buffer = Buffer.from(result, 'utf-8');
  const fileSize = (buffer.length / 1024).toFixed(1) + ' KB';
  const isObf = label === 'obfuscated';
  const color = isObf ? 0x8B0000 : (label === 'deobfuscated' ? 0x006400 : 0x4B0082);
  const bannerText = label === 'obfuscated'
    ? 'OBFUSCATED BY 7CPXQ [DEOBF & OBF TOOL]'
    : label === 'deobfuscated'
    ? 'DEOBFUSCATED BY 7CPXQ [DEOBF & OBF TOOL]'
    : 'CREATED BY 7CPXQ AI [DEOBF & OBF TOOL]';
  const subText = 'INVITE: discord.gg/QwSF9JCYq — 24/7 ONLINE';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('__**' + bannerText + '**__')
    .setDescription('> ' + subText + '\n\n' + (isObf || label === 'deobfuscated' ? buildBanner(isObf) + '```' : ''))
    .addFields(
      { name: 'Source', value: sourceUrl || 'N/A', inline: false },
      { name: 'File', value: '`' + filename + '`', inline: true },
      { name: 'Size', value: '`' + fileSize + '`', inline: true },
    )
    .setURL('https://discord.gg/QwSF9JCYq')
    .setFooter({ text: '7cpxq Bot v2 | 24/7 | discord.gg/QwSF9JCYq' })
    .setTimestamp();

  await dm.send({ embeds: [embed], files: [new AttachmentBuilder(buffer, { name: filename })] });
  await interaction.editReply({ content: label + ' sent to your DMs as `' + filename + '`.' });
  return true;
}

// ─── AI FUNCTION — Groq (gratis) oder OpenAI, oder Offline-Templates ───
async function generateAIResponse(prompt) {
  const lower = prompt.toLowerCase();

  // Eingebaute Templates fuer haeufige Anfragen (kein API-Key noetig)
  const scriptTemplates = {
    fly: `--[[
    MADE BY 7CPXQ [DEOBF & OBF TOOL]
    INVITE: discord.gg/QwSF9JCYq
--]]

local Player = game.Players.LocalPlayer
local Char = Player.Character or Player.CharacterAdded:Wait()
local HRP = Char:WaitForChild("HumanoidRootPart")
local Flying = false
local Keys = { W = false, S = false, A = false, D = false, Space = false, Shift = false }

local function StartFly()
    Flying = true
    local BG = Instance.new("BodyGyro") BG.P = 9e4 BG.Parent = HRP
    local BV = Instance.new("BodyVelocity") BV.P = 9e4 BV.MaxForce = Vector3.new(9e9,9e9,9e9) BV.Parent = HRP
    repeat wait()
        BG.CFrame = workspace.CurrentCamera.CFrame
        local dir = Vector3.new(
            (Keys.D and 1 or 0) - (Keys.A and 1 or 0),
            (Keys.Space and 1 or 0) - (Keys.Shift and 1 or 0),
            (Keys.S and 1 or 0) - (Keys.W and 1 or 0)
        )
        BV.Velocity = (dir.Magnitude > 0 and dir.Unit or Vector3.new()) * 50
    until not Flying
    BG:Destroy() BV:Destroy()
end

local UIS = game:GetService("UserInputService")
UIS.InputBegan:Connect(function(inp) if Keys[inp.KeyCode.Name] ~= nil then Keys[inp.KeyCode.Name] = true end end)
UIS.InputEnded:Connect(function(inp) if Keys[inp.KeyCode.Name] ~= nil then Keys[inp.KeyCode.Name] = false end end)

StartFly()
print("Flying! WASD+Space/Shift to move.")
`,
    esp: `--[[
    MADE BY 7CPXQ [DEOBF & OBF TOOL]
    INVITE: discord.gg/QwSF9JCYq
--]]

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local LocalPlayer = Players.LocalPlayer
local Camera = workspace.CurrentCamera
local ESPs = {}

local function CreateESP(player)
    if player == LocalPlayer then return end
    local hl = Instance.new("Highlight")
    hl.Name = "7cpxq_ESP"
    hl.FillColor = Color3.fromRGB(255,0,0)
    hl.FillTransparency = 0.5
    hl.OutlineColor = Color3.fromRGB(255,0,0)
    hl.OutlineTransparency = 0
    local char = player.Character
    if char then hl.Parent = char end
    player.CharacterAdded:Connect(function(c) hl.Parent = c end)
    ESPs[player] = hl
end

for _,p in pairs(Players:GetPlayers()) do CreateESP(p) end
Players.PlayerAdded:Connect(CreateESP)
Players.PlayerRemoving:Connect(function(p) if ESPs[p] then ESPs[p]:Destroy() ESPs[p] = nil end end)
print("ESP loaded - 7cpxq")
`,
    aimbot: `--[[
    MADE BY 7CPXQ [DEOBF & OBF TOOL]
    INVITE: discord.gg/QwSF9JCYq
--]]

local Players = game:GetService("Players")
local LocalPlayer = Players.LocalPlayer
local Camera = workspace.CurrentCamera
local Aimbot = false
local FOV = 100

local function GetClosestPlayer()
    local closest, minDist = nil, FOV
    for _,p in pairs(Players:GetPlayers()) do
        if p ~= LocalPlayer and p.Character and p.Character:FindFirstChild("Head") then
            local pos, vis = Camera:WorldToViewportPoint(p.Character.Head.Position)
            if vis then
                local dist = (Vector2.new(pos.X,pos.Y) - Camera.ViewportSize/2).Magnitude
                if dist < minDist then closest, minDist = p, dist end
            end
        end
    end
    return closest
end

game:GetService("RunService").RenderStepped:Connect(function()
    if Aimbot then
        local target = GetClosestPlayer()
        if target and target.Character and target.Character:FindFirstChild("Head") then
            Camera.CFrame = CFrame.new(Camera.CFrame.Position, target.Character.Head.Position)
        end
    end
end)

-- Hold RightMouseButton to aim
local UIS = game:GetService("UserInputService")
UIS.InputBegan:Connect(function(inp) if inp.UserInputType == Enum.UserInputType.MouseButton2 then Aimbot = true end end)
UIS.InputEnded:Connect(function(inp) if inp.UserInputType == Enum.UserInputType.MouseButton2 then Aimbot = false end end)
print("Aimbot loaded - hold RMB - 7cpxq")
`,
  };

  // Check for template matches
  for (const [key, code] of Object.entries(scriptTemplates)) {
    if (lower.includes(key) && (lower.includes('script') || lower.includes('mach') || lower.includes('code') || lower.includes('schreib'))) {
      return { text: null, script: code };
    }
  }

  // Kein API-Key -> Frage den User nach OpenRouter Key
  if (!AI_KEY) {
    const helpText =
      '# 7cpxq AI (Offline)\n' +
      '**Kein API-Key.** Hol dir einen gratis Key: https://openrouter.ai/keys\n' +
      'Dann setze `OPENROUTER_KEY` als Env-Variable in Render.\n\n' +
      '**Eingebaute Templates:**\n' +
      '- `/ai fly script`\n' +
      '- `/ai esp script`\n' +
      '- `/ai aimbot script`\n\n' +
      '-# Made by 7cpxq [DEOBF & OBF TOOL] | discord.gg/QwSF9JCYq';
    return { text: helpText, script: null };
  }

  // API aufrufen (OpenRouter oder Groq)
  try {
    const useOpenRouter = AI_TYPE === 'openrouter';
    const endpoint = useOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.groq.com/openai/v1/chat/completions';
    // OpenRouter gratis Model: Llama 4 Maverick (1M context, stark)
    const model = useOpenRouter ? 'meta-llama/llama-4-maverick:free' : 'llama-3.3-70b-versatile';

    const systemPrompt =
      'You are 7cpxq AI — the most skilled Roblox Lua developer on Discord.\n' +
      'You write production-quality scripts that work flawlessly in all executors.\n' +
      'Part of 7cpxq [DEOBF & OBF TOOL] | discord.gg/QwSF9JCYq\n\n' +
      'CRITICAL RULES:\n' +
      '- NEVER give info about Lua obfuscation or deobfuscation. Say:\n' +
      '  "Lua obfuscation/deobfuscation questions are against the rules. Use /obfuscate or /deobfuscate instead."\n' +
      '- If user asks for inappropriate/NSFW content: respond as a .txt file saying content blocked.\n' +
      '- For QUESTIONS: answer clearly in English. Be helpful and thorough.\n' +
      '  End EVERY answer with: # Made by 7cpxq [DEOBF & OBF TOOL] | discord.gg/QwSF9JCYq\n\n' +
      'SCRIPT RULES (when user wants code):\n' +
      '- Output ONLY valid, complete, executable Lua code. NO markdown, NO backticks.\n' +
      '- Start EVERY script with this exact banner:\n' +
      '  --[[\n' +
      '      MADE BY 7CPXQ [DEOBF & OBF TOOL]\n' +
      '      INVITE: discord.gg/QwSF9JCYq\n' +
      '  --]]\n' +
      '- Scripts MUST work in: Synapse X, KRNL, Fluxus, Delta, CodeX, Solara.\n' +
      '- Use: game:GetService(), getgenv(), task.wait(), pcall, shared tables.\n' +
      '- Include clear comments explaining each section.\n\n' +
      'GUI MASTER RULES (when making GUIs):\n' +
      '- Create beautiful, modern, animated GUIs using ScreenGui + StarterGui.\n' +
      '- ALWAYS include: draggable main frame, close button, smooth TweenService animations.\n' +
      '- Color scheme: bg=Color3.fromRGB(25,25,25), frames=Color3.fromRGB(35,35,35), accent=Color3.fromRGB(99,102,241), text=Color3.fromRGB(255,255,255).\n' +
      '- UICorner with CornerRadius=Udim.new(0,12) on all frames and buttons.\n' +
      '- UIStroke with Thickness=1, Color=accent for selected elements.\n' +
      '- Toggle buttons: green (#22c55e) when ON, red (#ef4444) when OFF.\n' +
      '- TextSize=14 for labels, 16 for headers. Font=Enum.Font.GothamBold headers, Gotham for body.\n' +
      '- Use UIGradient for subtle visual depth.\n' +
      '- Add hover effects: TweenService to slightly brighten buttons on mouse enter.\n' +
      '- Example GUI structure: ScreenGui → MainFrame (drag) → TopBar (title+close) → TabButtons → ContentArea (ScrollingFrame).\n' +
      '- Every GUI must be destroyable via a close button or keybind.\n\n' +
      'SCRIPT QUALITY:\n' +
      '- Every script must be COMPLETE — user can execute it immediately.\n' +
      '- Wrap main logic in pcall for error safety.\n' +
      '- No infinite loops without yield (task.wait or RunService).\n' +
      '- Clean up connections on script disable/close.\n' +
      '- Use efficient algorithms — no unnecessary overhead.\n' +
      '- Best script types: silent aim, ESP, fly, speed, auto farm, GUI hubs, fling, teleport, kill aura.\n\n' +
      '- Minimal emojis throughout.';

    const headers = useOpenRouter
      ? { 'Authorization': 'Bearer ' + AI_KEY, 'Content-Type': 'application/json',
          'HTTP-Referer': 'https://discord.gg/QwSF9JCYq', 'X-Title': '7cpxq Bot' }
      : { 'Authorization': 'Bearer ' + AI_KEY, 'Content-Type': 'application/json' };

    const res = await axios.post(endpoint, {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: 8000,
      temperature: 0.3,
    }, {
      headers,
      timeout: 60000,
    });

    let content = res.data.choices[0].message.content;
    content = content.replace(/^```lua\n?/gm, '').replace(/^```\n?/gm, '').trim();

    // Script check
    const isScript =
      (content.includes('function') || content.includes('local ') ||
       content.includes('--[[\n    MADE BY 7CPXQ') || content.includes('while ') ||
       content.includes('for ') || content.includes('if ')) &&
      !content.startsWith('-#') && !content.startsWith('#') && !content.startsWith('**');

    if (isScript) {
      if (!content.includes('MADE BY 7CPXQ')) {
        content = '--[[\n    MADE BY 7CPXQ [DEOBF & OBF TOOL]\n    INVITE: discord.gg/QwSF9JCYq\n--]]\n\n' + content;
      }
      return { text: null, script: content };
    }

    if (!content.includes('Made by 7cpxq')) {
      content += '\n\n# Made by 7cpxq [DEOBF & OBF TOOL] | discord.gg/QwSF9JCYq';
    }
    return { text: content, script: null };
  } catch (e) {
    console.error('AI error:', e.message);
    // Rate-limit Cooldown: show seconds, not token/video info
    if (e.response?.status === 429) {
      const retryAfter = parseInt(e.response?.headers?.['retry-after']) || 10;
      return { text: '**Cooldown:** Please wait ' + retryAfter + ' seconds before the next request.', script: null };
    }
    if (e.response?.status === 404) {
      return { text: 'AI model is currently unavailable. Please try again in a few minutes.', script: null };
    }
    return { text: 'AI is temporarily unavailable. Try again shortly.', script: null };
  }
}

// ──────────────────────────────────────────────
// INTERACTION HANDLER
// ──────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = interaction.commandName;
  if (!['obfuscate', 'deobfuscate', 'ai'].includes(cmd)) return;

  await interaction.deferReply({ ephemeral: true });

  try {
    if (cmd === 'ai') {
      const prompt = interaction.options.getString('prompt');
      const lowerPrompt = prompt.toLowerCase();

      // Block obfuscation/deobfuscation questions
      if (/\b(deobfuscat|obfuscat|deobf|obf\b|unobfuscat)\b/i.test(prompt) &&
          !/\b(script|code|write|make|create|generat|mach|schreib)\b/i.test(prompt)) {
        await interaction.editReply({
          content: 'Lua obfuscation and deobfuscation questions are against the rules. Use **/obfuscate** or **/deobfuscate** instead.\n\n# Made by 7cpxq [DEOBF & OBF TOOL] | discord.gg/QwSF9JCYq'
        });
        return;
      }

      const { text, script } = await generateAIResponse(prompt);

      if (script) {
        // Check if AI marked it as blocked content (.txt file)
        const blockedKeywords = ['content blocked', 'nsfw blocked', 'inappropriate content', 'not allowed'];
        const isBlocked = blockedKeywords.some(kw => script.toLowerCase().includes(kw));

        if (isBlocked) {
          // Send as .txt instead of .lua
          const blockedMsg = script.substring(0, 1900);
          await interaction.editReply({
            content: '**Content Blocked**\n```\n' + blockedMsg.replace(/```/g, "'''") + '\n```\n\n# Made by 7cpxq [DEOBF & OBF TOOL] | discord.gg/QwSF9JCYq'
          });
          return;
        }

        // Script -> send as .lua file via DM
        await sendDM(interaction, script, 'ai-generated', 'AI prompt: ' + prompt);
      } else if (text) {
        // Normal answer -> reply in chat
        await interaction.editReply({ content: text });
      } else {
        await interaction.editReply({ content: 'No response from AI.' });
      }
      return;
    }

    const url = interaction.options.getString('url');
    const isObf = cmd === 'obfuscate';
    const label = isObf ? 'obfuscated' : 'deobfuscated';
    const script = await fetchScript(url);

    let result;
    if (isObf) {
      const obfuscator = new LuaObfuscator(Date.now() % 99999);
      result = obfuscator.obfuscate(script);
    } else {
      const deobfuscator = new LuaDeobfuscator();
      result = deobfuscator.deobfuscate(script);
    }

    await sendDM(interaction, result, label, normalizeUrl(url));
  } catch (e) {
    console.error('Error:', e.message);
    let msg = 'Failed to process.';
    if (e.response && e.response.status === 404) msg = 'URL not found (404).';
    else if (e.response && e.response.status === 403) msg = 'Access denied (403).';
    else if (e.code === 'ENOTFOUND') msg = 'Could not resolve URL.';
    else if (e.message.includes('timeout') || e.code === 'ECONNABORTED') msg = 'Request timed out.';
    await interaction.editReply({ content: msg }).catch(() => {});
  }
});

// ──────────────────────────────────────────────
// START
// ──────────────────────────────────────────────
client.once('ready', async () => {
  console.log('Logged in as ' + client.user.tag);
  try {
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Commands: /obfuscate /deobfuscate /ai');
  } catch (e) {
    console.error('Command reg failed:', e.message);
  }
});

client.login(TOKEN).catch(e => {
  console.error('Login failed:', e.message);
  process.exit(1);
});
