package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Sentence 练习用的英文材料。Level 为 CEFR 难度（B1/B2/C1）或「导入」。
type Sentence struct {
	ID          string `json:"id"`
	Text        string `json:"text"`
	Translation string `json:"translation"`
	Category    string `json:"category"`
	Level       string `json:"level"`
	Imported    bool   `json:"imported"`
}

// Recording 一次录音的元数据，音频文件与索引都保存在本地数据目录中。
type Recording struct {
	ID          string `json:"id"`
	SentenceID  string `json:"sentenceId"`
	Text        string `json:"text"`
	Translation string `json:"translation"`
	DurationMs  int    `json:"durationMs"`
	CreatedAt   string `json:"createdAt"`
	Filename    string `json:"filename"`
}

// ImportResult 导入结果统计。
type ImportResult struct {
	Title   string `json:"title"`
	Added   int    `json:"added"`
	Skipped int    `json:"skipped"`
}

var sentenceLibrary = []Sentence{
	// ---------- B1 ----------
	{ID: "d1", Text: "Could you say that again, please?", Translation: "你能再说一遍吗？", Category: "日常口语", Level: "B1"},
	{ID: "d2", Text: "I'd like a coffee with a splash of milk.", Translation: "我想要一杯加少许牛奶的咖啡。", Category: "日常口语", Level: "B1"},
	{ID: "d3", Text: "How long does it take to get to the airport?", Translation: "到机场需要多长时间？", Category: "日常口语", Level: "B1"},
	{ID: "d4", Text: "I'm sorry, I didn't quite catch what you said.", Translation: "抱歉，我没太听清你说的话。", Category: "日常口语", Level: "B1"},
	{ID: "d5", Text: "Let's grab a bite to eat after work.", Translation: "下班后我们去吃点东西吧。", Category: "日常口语", Level: "B1"},

	{ID: "b1-1", Text: "I usually take the bus to work because it's cheaper than driving.", Translation: "我通常坐公交上班，因为比开车便宜。", Category: "日常生活", Level: "B1"},
	{ID: "b1-2", Text: "She has been learning English for about two years.", Translation: "她学英语大约有两年了。", Category: "学习成长", Level: "B1"},
	{ID: "b1-3", Text: "The weather is supposed to be sunny this weekend.", Translation: "这个周末天气应该是晴天。", Category: "日常生活", Level: "B1"},
	{ID: "b1-4", Text: "I'm not sure if I can finish the report by tomorrow.", Translation: "我不确定明天之前能否完成这份报告。", Category: "职场沟通", Level: "B1"},
	{ID: "b1-5", Text: "Could you recommend a good place to eat around here?", Translation: "你能推荐附近好吃的地方吗？", Category: "旅行出行", Level: "B1"},
	{ID: "b1-6", Text: "He missed the train, so he had to take a taxi.", Translation: "他错过了火车，只好打车。", Category: "旅行出行", Level: "B1"},
	{ID: "b1-7", Text: "I think it's better to book the tickets in advance.", Translation: "我觉得最好提前订票。", Category: "旅行出行", Level: "B1"},
	{ID: "b1-8", Text: "She said she would call me back in ten minutes.", Translation: "她说十分钟后给我回电话。", Category: "日常沟通", Level: "B1"},
	{ID: "b1-9", Text: "The museum is closed on Mondays, so let's go on Tuesday.", Translation: "博物馆周一闭馆，我们周二去吧。", Category: "旅行出行", Level: "B1"},
	{ID: "b1-10", Text: "I need to practice speaking more to build my confidence.", Translation: "我需要多练口语来建立自信。", Category: "学习成长", Level: "B1"},
	{ID: "b1-11", Text: "My phone battery dies very quickly these days.", Translation: "最近我的手机电池掉电很快。", Category: "日常生活", Level: "B1"},
	{ID: "b1-12", Text: "Would you mind speaking a little more slowly?", Translation: "你介意说慢一点吗？", Category: "日常沟通", Level: "B1"},

	// ---------- B2 ----------
	{ID: "w1", Text: "Could you walk me through the agenda for today's meeting?", Translation: "你能带我过一遍今天会议的议程吗？", Category: "职场沟通", Level: "B2"},
	{ID: "w2", Text: "I'll follow up with the client and get back to you by Friday.", Translation: "我会跟进客户，周五前回复你。", Category: "职场沟通", Level: "B2"},
	{ID: "w3", Text: "We need to align on the timeline before we move forward.", Translation: "在推进之前，我们需要就时间安排达成一致。", Category: "职场沟通", Level: "B2"},
	{ID: "w4", Text: "Thanks for bringing that up, it's a really good point.", Translation: "谢谢你提出这一点，这确实是个好观点。", Category: "职场沟通", Level: "B2"},
	{ID: "w5", Text: "Let me summarize the action items from our discussion.", Translation: "让我总结一下我们讨论的行动事项。", Category: "职场沟通", Level: "B2"},

	{ID: "b2-1", Text: "Although the proposal looked promising, we still need to review the risks.", Translation: "尽管这个方案看起来很有前景，我们仍需评估风险。", Category: "观点表达", Level: "B2"},
	{ID: "b2-2", Text: "The company decided to postpone the launch until the bugs were fixed.", Translation: "公司决定推迟发布，直到缺陷修复。", Category: "职场沟通", Level: "B2"},
	{ID: "b2-3", Text: "I'd rather work from home, as long as the team stays in touch.", Translation: "只要团队保持联系，我更愿意在家办公。", Category: "观点表达", Level: "B2"},
	{ID: "b2-4", Text: "Despite the heavy rain, the event went ahead as planned.", Translation: "尽管下着大雨，活动仍按计划进行。", Category: "时事叙述", Level: "B2"},
	{ID: "b2-5", Text: "It's worth reading the instructions before you start the installation.", Translation: "开始安装之前，值得先读一下说明。", Category: "学习成长", Level: "B2"},
	{ID: "b2-6", Text: "She managed to persuade the manager to extend the deadline.", Translation: "她成功说服经理延长了截止日期。", Category: "职场沟通", Level: "B2"},
	{ID: "b2-7", Text: "The report suggests that remote work improves productivity for some teams.", Translation: "报告显示，远程办公提高了部分团队的效率。", Category: "时事叙述", Level: "B2"},
	{ID: "b2-8", Text: "We should take the customer's feedback into account before redesigning the page.", Translation: "重新设计页面之前，我们应该考虑客户的反馈。", Category: "职场沟通", Level: "B2"},
	{ID: "b2-9", Text: "If I had known the traffic would be this bad, I would have left earlier.", Translation: "早知道堵车这么严重，我就早点出发了。", Category: "日常沟通", Level: "B2"},
	{ID: "b2-10", Text: "The main reason I enjoy this podcast is that the host speaks clearly.", Translation: "我喜欢这个播客的主要原因是主持人吐字清楚。", Category: "学习成长", Level: "B2"},
	{ID: "b2-11", Text: "He was offered the position, but he turned it down to finish his studies.", Translation: "他得到了这个职位，但为了完成学业而拒绝了。", Category: "时事叙述", Level: "B2"},
	{ID: "b2-12", Text: "Let's break the project into smaller tasks so we can track progress.", Translation: "我们把项目拆成更小的任务，这样便于跟踪进度。", Category: "职场沟通", Level: "B2"},

	// ---------- C1 ----------
	{ID: "s1", Text: "The only way to do great work is to love what you do.", Translation: "做出伟大工作的唯一方法，就是热爱你所做的事。", Category: "演讲表达", Level: "C1"},
	{ID: "s2", Text: "Success is not final, failure is not fatal.", Translation: "成功不是终点，失败也不致命。", Category: "演讲表达", Level: "C1"},
	{ID: "s3", Text: "Small steps every day lead to big changes over time.", Translation: "每天迈出一小步，终将带来巨大的改变。", Category: "演讲表达", Level: "C1"},
	{ID: "s4", Text: "Confidence comes from practice, not from perfection.", Translation: "自信来自练习，而不是完美。", Category: "演讲表达", Level: "C1"},

	{ID: "c1-1", Text: "The evidence presented in the study challenges a long-held assumption about memory.", Translation: "这项研究提出的证据挑战了关于记忆的一个长期假设。", Category: "学术阅读", Level: "C1"},
	{ID: "c1-2", Text: "Her argument was compelling, yet it left several important questions unanswered.", Translation: "她的论证很有说服力，但仍遗留了几个重要问题没有解答。", Category: "观点表达", Level: "C1"},
	{ID: "c1-3", Text: "The committee's decision, however controversial, was reached through due process.", Translation: "委员会的决定虽然争议很大，但走的是正当程序。", Category: "时事叙述", Level: "C1"},
	{ID: "c1-4", Text: "Scarcely had the announcement been made when criticism began to surface.", Translation: "公告刚一发布，批评便开始浮现。", Category: "时事叙述", Level: "C1"},
	{ID: "c1-5", Text: "The novel explores how ambition can gradually erode a person's integrity.", Translation: "这部小说探讨了野心如何一步步侵蚀一个人的正直。", Category: "文学赏析", Level: "C1"},
	{ID: "c1-6", Text: "What struck me most was the author's willingness to acknowledge her own bias.", Translation: "最打动我的是作者愿意承认自己的偏见。", Category: "文学赏析", Level: "C1"},
	{ID: "c1-7", Text: "The policy aims to strike a delicate balance between growth and sustainability.", Translation: "该政策旨在在增长与可持续之间取得微妙的平衡。", Category: "学术阅读", Level: "C1"},
	{ID: "c1-8", Text: "His remarks, taken out of context, gave rise to a great deal of misunderstanding.", Translation: "他的话被断章取义，引发了大量误解。", Category: "时事叙述", Level: "C1"},
	{ID: "c1-9", Text: "Underlying the debate is a deeper disagreement about what counts as progress.", Translation: "这场争论的背后，是关于什么才算进步的更深分歧。", Category: "观点表达", Level: "C1"},
	{ID: "c1-10", Text: "The findings are consistent with a growing body of research on habit formation.", Translation: "这些发现与越来越多关于习惯养成的研究一致。", Category: "学术阅读", Level: "C1"},
	{ID: "c1-11", Text: "It is by no means certain that the proposed reforms will deliver the expected results.", Translation: "拟议的改革能否取得预期效果，远未可知。", Category: "学术阅读", Level: "C1"},
	{ID: "c1-12", Text: "Rather than dismissing the criticism, the team treated it as an opportunity to refine the design.", Translation: "团队没有对批评置之不理，而是把它当作完善设计的机会。", Category: "观点表达", Level: "C1"},
}

const (
	indexFileName    = "recordings.json"
	importedFileName = "imported.json"
	importedLevel    = "导入"
)

// App 是暴露给前端调用的后端对象。
type App struct {
	ctx      context.Context
	mu       sync.Mutex
	dataDir  string
	records  []Recording
	imported []Sentence
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	base, err := os.UserConfigDir()
	if err != nil || base == "" {
		base = "."
	}
	a.dataDir = filepath.Join(base, "EchoLearn")
	if err := os.MkdirAll(a.dataDir, 0o755); err != nil {
		fmt.Println("创建数据目录失败:", err)
	}
	a.loadRecordings()
	a.loadImported()
}

func (a *App) indexPath() string {
	return filepath.Join(a.dataDir, indexFileName)
}

func (a *App) importedPath() string {
	return filepath.Join(a.dataDir, importedFileName)
}

func (a *App) loadRecordings() {
	a.mu.Lock()
	defer a.mu.Unlock()

	data, err := os.ReadFile(a.indexPath())
	if err != nil {
		return
	}
	var list []Recording
	if err := json.Unmarshal(data, &list); err == nil {
		a.records = list
	}
}

func (a *App) loadImported() {
	a.mu.Lock()
	defer a.mu.Unlock()

	data, err := os.ReadFile(a.importedPath())
	if err != nil {
		return
	}
	var list []Sentence
	if err := json.Unmarshal(data, &list); err == nil {
		a.imported = list
	}
}

func (a *App) saveIndexLocked() error {
	data, err := json.MarshalIndent(a.records, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(a.indexPath(), data, 0o644)
}

func (a *App) saveImportedLocked() error {
	data, err := json.MarshalIndent(a.imported, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(a.importedPath(), data, 0o644)
}

// ListSentences 返回内置句子库与用户导入的材料。
func (a *App) ListSentences() []Sentence {
	a.mu.Lock()
	defer a.mu.Unlock()

	out := make([]Sentence, 0, len(sentenceLibrary)+len(a.imported))
	out = append(out, sentenceLibrary...)
	out = append(out, a.imported...)
	return out
}

// ---------------- 材料导入 ----------------

// ImportFromFile 弹出文件选择框，导入 .txt / .md / .json 阅读材料。
func (a *App) ImportFromFile() (ImportResult, error) {
	path, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择阅读材料",
		Filters: []runtime.FileFilter{
			{DisplayName: "阅读材料 (*.txt;*.md;*.json)", Pattern: "*.txt;*.md;*.json"},
			{DisplayName: "文本文件 (*.txt)", Pattern: "*.txt"},
			{DisplayName: "Markdown (*.md)", Pattern: "*.md"},
			{DisplayName: "JSON (*.json)", Pattern: "*.json"},
		},
	})
	if err != nil {
		return ImportResult{}, err
	}
	if strings.TrimSpace(path) == "" {
		return ImportResult{}, nil // 用户取消
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return ImportResult{}, fmt.Errorf("读取文件失败: %w", err)
	}
	ext := filepath.Ext(path)
	title := strings.TrimSuffix(filepath.Base(path), ext)
	return a.importContent(title, string(data), ext)
}

// ImportFromText 导入前端粘贴的文本材料。
func (a *App) ImportFromText(title, content string) (ImportResult, error) {
	return a.importContent(title, content, ".txt")
}

func (a *App) importContent(title, content, ext string) (ImportResult, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		title = "我的材料"
	}
	if strings.TrimSpace(content) == "" {
		return ImportResult{}, fmt.Errorf("导入内容为空")
	}

	parsed, err := parseMaterial(title, content, ext)
	if err != nil {
		return ImportResult{}, err
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	seen := make(map[string]bool, len(sentenceLibrary)+len(a.imported))
	for _, s := range sentenceLibrary {
		seen[normalizeText(s.Text)] = true
	}
	for _, s := range a.imported {
		seen[normalizeText(s.Text)] = true
	}

	res := ImportResult{Title: title}
	for _, s := range parsed {
		key := normalizeText(s.Text)
		if key == "" || seen[key] {
			res.Skipped++
			continue
		}
		seen[key] = true
		s.ID = "imp-" + time.Now().Format("20060102-150405") + "-" + randomSuffix(3)
		a.imported = append(a.imported, s)
		res.Added++
	}

	if res.Added > 0 {
		if err := a.saveImportedLocked(); err != nil {
			return res, fmt.Errorf("保存导入材料失败: %w", err)
		}
	}
	return res, nil
}

// DeleteImportedSentence 删除一条用户导入的材料。
func (a *App) DeleteImportedSentence(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	idx := -1
	for i, s := range a.imported {
		if s.ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return fmt.Errorf("该材料不是导入内容")
	}
	a.imported = append(a.imported[:idx], a.imported[idx+1:]...)
	return a.saveImportedLocked()
}

func parseMaterial(title, content, ext string) ([]Sentence, error) {
	content = strings.TrimPrefix(content, "\ufeff")
	if strings.EqualFold(ext, ".json") {
		return parseJSONMaterial(title, content)
	}
	return parseTextMaterial(title, content), nil
}

// parseTextMaterial 按行解析：一行一句；支持 "# 标题" 分组；用 | 或 Tab 分隔中英对照。
func parseTextMaterial(title, content string) []Sentence {
	var out []Sentence
	section := title

	for _, raw := range strings.Split(content, "\n") {
		line := strings.TrimSpace(strings.TrimSuffix(raw, "\r"))
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "#") {
			if h := strings.TrimSpace(strings.TrimLeft(line, "#")); h != "" {
				section = h
			}
			continue
		}
		line = strings.TrimSpace(strings.TrimLeft(line, "-*>+"))
		line = strings.TrimSpace(strings.TrimLeft(line, "•·"))
		line = stripLeadingNumber(line)
		text, translation := splitMaterialLine(line)
		text = strings.TrimSpace(strings.Trim(text, `"“”`))
		if text == "" {
			continue
		}
		out = append(out, Sentence{
			Text:        text,
			Translation: translation,
			Category:    section,
			Level:       importedLevel,
			Imported:    true,
		})
	}
	return out
}

func parseJSONMaterial(title, content string) ([]Sentence, error) {
	var items []map[string]any
	if err := json.Unmarshal([]byte(content), &items); err != nil {
		var wrapper struct {
			Sentences []map[string]any `json:"sentences"`
			Items     []map[string]any `json:"items"`
		}
		if err2 := json.Unmarshal([]byte(content), &wrapper); err2 != nil {
			return nil, fmt.Errorf("JSON 解析失败，请使用对象数组格式")
		}
		items = wrapper.Sentences
		if len(items) == 0 {
			items = wrapper.Items
		}
	}

	out := make([]Sentence, 0, len(items))
	for _, item := range items {
		text := firstString(item, "text", "en", "english")
		if text == "" {
			continue
		}
		translation := firstString(item, "translation", "zh", "chinese")
		category := firstString(item, "category", "topic", "title")
		if category == "" {
			category = title
		}
		out = append(out, Sentence{
			Text:        text,
			Translation: translation,
			Category:    category,
			Level:       importedLevel,
			Imported:    true,
		})
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("没有解析到有效句子，请检查 JSON 内容")
	}
	return out, nil
}

func splitMaterialLine(line string) (string, string) {
	for _, sep := range []string{"|", "\t", " :: ", " || "} {
		if idx := strings.Index(line, sep); idx > 0 {
			return strings.TrimSpace(line[:idx]), strings.TrimSpace(line[idx+len(sep):])
		}
	}
	return line, ""
}

func stripLeadingNumber(s string) string {
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i == 0 || i >= len(s) {
		return s
	}
	rest := s[i:]
	for _, sep := range []string{".", ")", "、", "．", "："} {
		if strings.HasPrefix(rest, sep) {
			return strings.TrimSpace(strings.TrimPrefix(rest, sep))
		}
	}
	return s
}

func firstString(item map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := item[k].(string); ok {
			if s := strings.TrimSpace(v); s != "" {
				return s
			}
		}
	}
	return ""
}

func normalizeText(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(s), " "))
}

// ---------------- 录音 ----------------

// ListRecordings 返回全部录音，按时间倒序。
func (a *App) ListRecordings() []Recording {
	a.mu.Lock()
	defer a.mu.Unlock()

	out := make([]Recording, len(a.records))
	copy(out, a.records)
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}

// SaveRecording 保存前端编码好的 WAV 音频（base64），返回录音元数据。
func (a *App) SaveRecording(sentenceID, text, translation string, durationMs int, audio string) (Recording, error) {
	if audio == "" {
		return Recording{}, fmt.Errorf("录音数据为空")
	}
	if strings.HasPrefix(audio, "data:") {
		if idx := strings.Index(audio, ","); idx >= 0 {
			audio = audio[idx+1:]
		}
	}
	raw, err := base64.StdEncoding.DecodeString(audio)
	if err != nil {
		return Recording{}, fmt.Errorf("录音数据解析失败: %w", err)
	}

	id := time.Now().Format("20060102-150405") + "-" + randomSuffix(3)
	filename := id + ".wav"
	if err := os.WriteFile(filepath.Join(a.dataDir, filename), raw, 0o644); err != nil {
		return Recording{}, fmt.Errorf("写入录音文件失败: %w", err)
	}

	rec := Recording{
		ID:          id,
		SentenceID:  sentenceID,
		Text:        text,
		Translation: translation,
		DurationMs:  durationMs,
		CreatedAt:   time.Now().Format(time.RFC3339),
		Filename:    filename,
	}

	a.mu.Lock()
	a.records = append(a.records, rec)
	err = a.saveIndexLocked()
	a.mu.Unlock()
	if err != nil {
		return Recording{}, fmt.Errorf("保存录音索引失败: %w", err)
	}
	return rec, nil
}

// GetRecordingAudio 以 data URL 形式返回录音音频，供前端直接播放。
func (a *App) GetRecordingAudio(id string) (string, error) {
	a.mu.Lock()
	filename := ""
	for _, r := range a.records {
		if r.ID == id {
			filename = r.Filename
			break
		}
	}
	a.mu.Unlock()

	if filename == "" {
		return "", fmt.Errorf("未找到该录音")
	}
	data, err := os.ReadFile(filepath.Join(a.dataDir, filename))
	if err != nil {
		return "", fmt.Errorf("读取录音文件失败: %w", err)
	}
	return "data:audio/wav;base64," + base64.StdEncoding.EncodeToString(data), nil
}

// DeleteRecording 删除录音文件及其索引记录。
func (a *App) DeleteRecording(id string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	idx := -1
	filename := ""
	for i, r := range a.records {
		if r.ID == id {
			idx = i
			filename = r.Filename
			break
		}
	}
	if idx < 0 {
		return fmt.Errorf("未找到该录音")
	}

	a.records = append(a.records[:idx], a.records[idx+1:]...)
	if err := a.saveIndexLocked(); err != nil {
		return err
	}
	if filename != "" {
		_ = os.Remove(filepath.Join(a.dataDir, filename))
	}
	return nil
}

// OpenRecordingsFolder 在资源管理器中打开数据目录。
func (a *App) OpenRecordingsFolder() error {
	if a.dataDir == "" {
		return fmt.Errorf("数据目录未初始化")
	}
	return exec.Command("explorer.exe", a.dataDir).Start()
}

// GetStoragePath 返回录音与材料的存放目录。
func (a *App) GetStoragePath() string {
	return a.dataDir
}

func randomSuffix(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprint(time.Now().UnixNano() % 1000)
	}
	return hex.EncodeToString(buf)
}
