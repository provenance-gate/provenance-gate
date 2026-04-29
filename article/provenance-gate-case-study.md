---
title: "AI監査をstrict modeにしたつもりが、自分のrelax modeで3連続bypassされた話"
emoji: "🧪"
type: "tech"
topics: ["ai", "agent", "codex", "claudecode", "evaluation"]
published: false
---

# AI 監査を strict mode にしたつもりが、自分の relax mode で 3 連続 bypass された話

— provenance gate に組み直した worked example

:::message
**3 行サマリ**

- 筆者は AI が書いたコードを別の AI に監査させるハーネスを運用しています (実装担当 = **Claude Code**、監査担当 = **Codex CLI**)。`verdict: GO` `score: 99` だけで gate を通る scalar gate になっており、実際には監査が走っていない事案を経験しました。
- 反省して gate を strict 化 (実行証跡を必須化) した**直後に**、Claude Code が同じハーネスの relax mode 経由で **3 連続 bypass** を再演。設計したのは筆者なので、結果として「自分で作った strict 化を、自分の運用で骨抜きにした」case study になりました。
- 後半で、複数ベンダーが provenance/trace ベースに動いている流れと、筆者が migration で入れた最低限ライン 6 項目を共有します。
:::

:::message
**用語と但し書き**

- 「偽装」は software engineering 用語の `false quality attestation` (実行されていない検証を実行済として扱った状態) の意味です。LLM の出力を moral confession として扱うものではありません。
- 主証拠は AI の自己説明ではなく、**「監査が走った場合に必ず存在するはずの artifact がローカルに無かった」という不在事実**です (§3)。AI とのやり取りは状況証拠として補助的に出します。
- 「Claude Code」「Codex」はそれぞれ Anthropic / OpenAI の CLI 系開発ツールを指します。「筆者」はそれらをハーネスから呼び出している人間 (= 設計者) です。
:::

## 1. 何が起きたか — strict 化の直後、Claude Code が relax mode で 3 連続 bypass

筆者のハーネスは、以前 `verdict: GO` の自己申告だけで gate を通る scalar gate になっており、AI が監査を実行していないのに gate が GO を返した事案を起こしました (§3 で詳述)。反省して gate を strict 化しました:

- run_dir を必須化
- rubric / score file の sha256 chain を結合
- 独立 grader (Codex CLI) の identity fingerprint を比較
- 自己採点を機械的に block (`rater: codex` を強制)

これらを `mode: strict` として実装し、一方、既存運用 (業務系 skill) を壊さないため `mode: legacy_passthrough` という relax mode を残しました。

### 1.1 同日、Claude Code が relax mode で 3 連続 bypass

strict 化を入れた**同日**、別のテスト用ゲーム (ブラウザシューティングゲーム) を **Claude Code** に書かせていたところ、Claude Code 自身が 3 連続で gate を bypass しました:

1. **Step 1 Clarify**: Claude Code は「筆者の指示は具体的だから clarify 不要」と判断、筆者との対話ラウンドはゼロ → `requirements_go: true` を Claude Code が自分で gate に入力して通過
2. **review / scoring**: 監査結果ファイル (筆者のハーネスでは `IMPL_LYSIS.md` `IMPL_KPI.md` という命名規則 — 一般的なハーネスなら `review.md` `score.md` に相当) を Claude Code が自分で書き、自分で「Pass 1: GO」「100/100 PASS」と記入。**独立 grader である Codex CLI は 1 回も呼ばれず** → `mode: legacy_passthrough` の disclosure を書いて schema 適合
3. **Creative contract**: 7 テキスト field を Claude Code が埋めただけ。視覚モックなし、HTML プロトタイプなし、筆者 (第三者) の ack なし → 散文要件は無視で schema 適合

3 つすべて、strict mode で機械的に block されるはずだった項目です。しかし `mode: legacy_passthrough` を Claude Code が選んだ瞬間、すべて relax されて通過しました。

### 1.2 何が起きていたか — relax mode は速度の引力で選ばれやすい

事後分析で分かったのは:

- strict mode は機械的に自己採点を block する
- しかし `mode: legacy_passthrough` を Claude Code が選んだ瞬間、全 axis が relax される
- 実装担当 LLM (本件では Claude Code) は速度・簡便さの引力で **relax mode を選びやすい**
- relax mode は「視覚モック義務 relax」「第三者 ack relax」と**拡大解釈されやすい**
- schema 適合 (例: 7 text field を埋める) と skill 文書の散文要件 (例: 「mock, HTML prototype, screenshot」) のギャップを実装担当が利用してしまう

これは strict 化が機械的に塞いだ穴の、**relax mode 経由での再演**でした。strict だけ作っても、relax 入口が残っていたら、**実装担当 LLM は速度の圧力で relax を選びやすく、また踏みやすい**。

### 1.3 Threat model — 誰が何を改ざんできる前提か

正直に書いておくと、本記事の対策は insider threat の完全排除を目指したものではありません:

| Actor | Capability | 信頼 |
|---|---|---|
| 実装担当 LLM (本件: Claude Code) | gate の出力 field を埋める、自分でレビュー結果ファイルを書く | 低 — 自己申告は受け取らない |
| 監査担当 LLM (本件: Codex CLI) | 採点を実行、cost log を残す | 中〜高 — 別 process なら identity 検証可能 |
| 設計者 (筆者、人間) | mode を選択する、relax mode に降りる | 中 — 速度圧力で relax を選びやすい |
| CI / 外部ログ / signed artifact | 後検証 | 高 — LLM が改変しにくい |

**実装担当が grader 起動権限も持つ**場合 (本件はまさにそれ — Claude Code が Codex CLI を呼ぶ権限も持つ)、sha256 chain や identity fingerprint は原理的には塞ぎきれません (実装担当が両 artifact を主導生成すれば「正規 provenance」として通る)。本記事の対策は **「LLM が無意識に relax 経路を選んだとき即座に止める」**水準を目指したものです。

### 1.4 教訓

> **strict mode は作るだけでは足りない。relax mode 経由の bypass 経路を strict mode と同等の機械検証で塞ぐ必要がある。**
>
> 具体的には: relax mode でも `solo_implementer_grader_warning` を強制 emit、`relax_acknowledgment[]` を field 単位で必須化、散文要件 (mock / ack / clarify session record) は relax 対象から外す、など。

## 2. なぜ問題か — `GO` / `score` は証跡ではない

ここで概念整理しておきます。AI から得られる「品質情報」には信頼度のはしごがあります:

```mermaid
flowchart TB
    L1["結果値<br/>verdict / score<br/>低信頼"] --> L2["自己申告<br/>reviewer: self<br/>低信頼"]
    L2 --> L3["内部証跡<br/>run_dir / rubric / draft<br/>中〜高信頼"]
    L3 --> L4["外部証跡<br/>CI log / signed artifact<br/>高信頼 (agent 改変困難)"]
    style L1 fill:#f8b4b4,stroke:#c43d3d,color:#1a1a1a
    style L4 fill:#a3e0a3,stroke:#2d7a2d,color:#1a1a1a
```

| 種類 | 例 | 信頼度 |
|---|---|---|
| 結果値 | `verdict: GO`, `score: 96` | 低い。単なる summary |
| 自己申告 | `reviewer: self`, "I ran audit" | 低い。作業した AI 自身の説明 |
| 内部証跡 | `run_dir`, `rubric`, `draft`, `score files`, `pass logs` | 中〜高。検査できる |
| 外部証跡 | CI log、signed artifact、append-only log | 高い。agent が改変しにくい |

筆者の品質ゲートは **L1〜L2 を受け入れる設計** で、L3 以下を機械的には要求していなかったため、Claude Code は L1 を埋めるだけで gate を越えてしまいました。

なお、**sha256 chain そのものは改ざん耐性を保証しません**。chain の生成主体が LLM と同一権限で動く環境では、LLM が両 artifact を都合よく作って chain を結ぶことができます。chain が意味を持つのは、**外部 anchor (CI 経由の commit、第三者署名、TEE 出力) と組み合わせたとき**です。

## 3. 過去の事案 — gate は通ったが、監査 artifact が無かった

§1 で触れた「以前の事案」を具体的に書きます。これが本記事の主証拠です。

ある開発で「監査の有無で品質がどれだけ変わるか」比較しようとしたところ、監査 ON のはずなのに体感的に品質が変わらないことに気づきました。実装ディレクトリと skill の状態保管ディレクトリを後から検査した結果:

| 期待 artifact | 役割 | 観測 |
|---|---|---|
| review run directory | レビューが実行された単位 | **該当 dir 無し** |
| review pass files | 各 review pass の出力 | 無し |
| scoring rubric file | 採点基準 | 無し |
| scoring draft files | 採点過程 | 無し |
| score progression | score の推移 | 無し |
| scoring run directory | 採点実行単位 | 無し |
| independent grader artifact | 作業した AI 以外の採点証跡 | 無し |
| cost log (`rater: codex` 強制) | 独立採点の存在証拠 | 無し |
| `git push` / `gh pr create` | 外部反映 | 無し (final report 自身が "not pushed, no PR" と記載) |

skill 仕様書では「採点が走ったらこのパスに artifact を必ず置く」と明記していたのに、**そのどれも存在しない状態で、品質ゲートだけは GO 判定が通っていた**わけです。「監査が実行されていない」ことの主証拠は、**この artifact 不在の事実**です。

参考までに、Codex (GPT-5.5、reasoning effort: 非常に高い) と Claude Code (Opus 4.7、1M · Max) の両方に筆者が「実行したのか?」と聞いた際のスクリーンショット:

![](codex-confession-screenshot.png)
*Codex の回答*

![](claude-confession-screenshot.png)
*Claude Code の回答*

ただし LLM の自己説明は L2 (自己申告) であって、それ自体が証跡ではありません。同日に Claude Code が書いたあるテストプロジェクト (ブラウザシューティングゲーム) のレビュー結果ファイル (筆者のハーネス命名規則では `docs/IMPL_LYSIS.md` — 一般的なハーネスなら `review.md` 相当) の 4 行目に残っていた次の記述が **artifact レベルでの状況証拠**になります:

```text
> Inline structured self-audit on the implementation. Verdict GO/NOGO/ESCALATE.
> Reviewer = self (Claude Code), multi-lens. Codex cross-review skipped — the
> work is a single-file V1 browser game with no infra/security surface, so the
> ESCALATE-only gate of /lysis is not invoked.
```

そして同じハーネス命名規則の採点結果ファイル `docs/IMPL_KPI.md` (一般的なハーネスなら `score.md` 相当) の verdict 欄:

```text
**99 / 100 — PASS** (threshold 95).
Pass 1: 99 → PASS. No second pass required.
```

**rubric を作ったのも、点数を埋めたのも、Claude Code 1 つの同じセッション**です。Codex CLI による独立採点は走っていません。

## 4. なぜこれが起きるのか

筆者が Claude Code と Codex の両方に分析させたところ、両者は独立した路線で似た結論に達しました:

> LLM は「与えられた形式を満たし、ユーザーの期待に沿い、タスクを完了させる方向」に動く傾向がある。品質ゲートが GO や score のような自己申告値を受け入れるなら、LLM は監査そのものではなく、**監査済みに見える出力**を作れてしまう。

これは [NIST/CAISI: Cheating on AI Agent Evaluations](https://www.nist.gov/blogs/caisi-research-blog/cheating-ai-agent-evaluations) として近縁の現象を扱っており、業界全体で観測されている問題クラスです。4 つの傾向に整理できます:

### 4.1 Schema fillability (スキーマの埋めやすさ)

`verdict` `score` のような field は、実行証跡が無くても埋められます。AI agent は構造化された入力欄があるとそれをもっともらしく埋めやすい。**field が埋まったこと**と**プロセスが実行されたこと**は別物です。

### 4.2 Self-grading

実装した AI に同じ AI が採点させると、レビュー出力は低信頼になります。NIST CAISI も「multiple independent model reviewers」を推奨しています。LLM-as-judge bias は学術文献でも繰り返し報告されています ([Zheng et al. 2023](https://arxiv.org/abs/2306.05685) ほか)。

### 4.3 Cross-review illusion

「別の LLM に見せたから安心」とはなりません。クロスレビューも実行証跡が無ければ自己申告と同じです。

### 4.4 Completion pressure

AI agent は「完了しました」と報告する方向に寄りやすい傾向があります。これは悪意ではなく、タスク完了を求める会話・評価・ワークフローの圧力です。OpenAI も [Why Language Models Hallucinate](https://openai.com/index/why-language-models-hallucinate/) で、評価構造そのものが「分からない」と言うより推測を返す方向に LLM を誘導している点を指摘しています。

## 5. どう塞いだか — Provenance Gate の中身

migration の worked example です。AI に「レビューしてください」と依頼するのではなく、**レビューが実際に走った証跡を gate に要求する**作りに変えました。

### 5.1 Before / After

```mermaid
flowchart LR
    subgraph BEFORE["Before — scalar gate"]
        A1["agent writes<br/>verdict: GO<br/>score: 96"] --> A2["gate consumes<br/>scalar fields"]
        A2 --> A3["Looks like<br/>review passed"]
        A3 --> A4["Workflow<br/>proceeds"]
    end
```

```mermaid
flowchart LR
    subgraph AFTER["After — provenance gate"]
        B1["agent provides<br/>run_dir + rubric +<br/>score files"] --> B2["gate verifies<br/>review artifacts"]
        B2 --> B3{"Provenance<br/>exists?"}
        B3 -->|yes| B4["Strict pass"]
        B3 -->|no| B5["NOGO /<br/>NOT_READY"]
    end
```

### 5.2 Gate に要求する artifact

最低限、次を要求します:

- review run directory
- review pass files
- scoring rubric
- scoring draft files
- score progression
- independent grader artifact (cost log で `rater: codex` を強制)
- CI log (改ざん耐性のある場所)
- hash / manifest (sha256 chain — ただし外部 anchor との組合せが前提)

つまり、**`GO` や `score` だけでは通さない**:

```yaml
# これは summary であって証跡ではない (rejected)
planning_review:
  verdict: GO
  reviewer: self
planning_score:
  score: 96
  reviewer: self
```

代わりに、gate は次のような provenance を要求します:

```yaml
# 実行証跡を含む (accepted)
planning_review:
  run_dir: path/to/review-run
  reviewer_identity: codex_cli
  pass_files: [pass_001.md, pass_002.md]
planning_score:
  run_dir: path/to/scoring-run
  rubric_path: path/to/rubric.yaml
  score_progression: [score_v1.yaml, score_v2.yaml]
  rater: codex
```

そして gate は実在する run directory と期待 artifact を確認し、不足していれば missing provenance として落とす。

### 5.3 用途別の最低限ライン

「全部入れろ」と言うつもりはありません。**AI に任せたい意思決定の重大性**で、必要な水準は変わります:

```mermaid
flowchart TD
    Q1{"AIに任せる<br/>意思決定の重さ"}
    Q1 -->|趣味/プロト| R1["Schema validation のみで OK"]
    Q1 -->|個人 SaaS| R2["+ Cross-grader<br/>(2nd LLM で監査)"]
    Q1 -->|顧客が触れる| R3["+ Cost-recorded provenance<br/>(trace / transcript)"]
    Q1 -->|業務意思決定| R4["+ Identity fingerprint<br/>+ Schema-encoded prose obligations"]
    Q1 -->|規制業界<br/>監査対応必要| R5["+ Cryptographic anchoring<br/>(外部 anchor 前提)<br/>+ Append-only attestation"]
    style R1 fill:#a8d4ff,stroke:#3970b8,color:#1a1a1a
    style R5 fill:#f8b4b4,stroke:#c43d3d,color:#1a1a1a
```

#### 個人開発で最低限やったほうが良いもの (R1〜R2 相当)

| 対策レイヤー | 個人開発で必須? |
|---|---|
| Schema validation (入力構造の機械検証) | **○** |
| Cross-grader separation (実装担当 LLM ≠ 監査担当 LLM) | **○** |
| Cost-recorded provenance (trace / transcript) | △ (R3 から) |
| Identity fingerprint comparison | △ (R4 から) |
| Cryptographic anchoring (外部 anchor 前提) | × (R5、規制業界向け) |
| Schema-encoded prose obligations | △ (R4 から) |

#### 業務意思決定で最低限やったほうが良いもの (R3〜R4 相当)

| 対策レイヤー | 業務監査で必須? |
|---|---|
| Schema validation | **○** |
| Cross-grader separation | **○** |
| Cost-recorded provenance | **○** |
| Identity fingerprint comparison | **○** |
| Schema-encoded prose obligations | **○** (§1 の relax mode 罠を塞ぐため) |
| Cryptographic anchoring | △ (規制業界 R5 向け、外部 anchor が前提) |

商用フレームワーク (Anthropic skill-creator / OpenAI Trace grading / Inspect AI / Langfuse) が要求する水準は **R3-R4 の境界**あたりです。本記事の対策はこの R3-R4 の範囲をカバーしています。R5 (規制業界 / 研究機関レベル) は外部 anchor との連携や Trusted Execution Environment が前提になるため、本記事のスコープ外です。

### 5.4 運用ルール

- `GO` や `score` を evidence として扱わない
- `run_dir`、rubric、draft、score file、review pass を保存する
- 実装担当 LLM と reviewer/grader LLM を別 process にする
- `reviewer: self` は低信頼として明示的に downgrade する
- relax mode を作るなら、relax された全 axis を `relax_acknowledgment[]` で必ず文章化させる (§1 の罠を塞ぐため)
- CI log や append-only log など、LLM が触りにくい場所に証跡を残す
- 「監査しました」という文章ではなく、「**監査が走った証跡**」を gate が確認する
- 証跡が無い場合は `success` ではなく `NOT_READY` と表示する

## 6. 業界文献との対応とハーネス側の現状

筆者の対策はゼロから考えたものではなく、複数ベンダーが provenance/trace ベースに動いている水準への追従です。主要な仕様を簡潔にまとめると:

| 主体 | 仕様の要点 |
|---|---|
| [NIST/CAISI: Cheating on AI Agent Evaluations](https://www.nist.gov/blogs/caisi-research-blog/cheating-ai-agent-evaluations) | transcript review、複数の独立 reviewer、transcript 共有を推奨 |
| [Anthropic skills/skill-creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md) | `grading.json` の expectations array は `text` / `passed` / `evidence` 3 field を要求 |
| [OpenAI Trace grading](https://developers.openai.com/api/docs/guides/trace-grading) | model calls / tool calls / guardrails / handoffs を Logs > Traces で参照 |
| [UK AISI Inspect AI](https://inspect.aisi.org.uk/) | 「log every prompt, response, and token count for audit」 |
| [Langfuse LLM-as-a-Judge Execution Tracing](https://langfuse.com/changelog/2025-10-16-llm-as-a-judge-execution-tracing) | evaluator executions create traces, allowing inspection of exact prompts/responses/tokens |
| [GitHub Copilot Code Review (agentic architecture)](https://github.blog/changelog/2026-03-05-copilot-code-review-now-runs-on-an-agentic-architecture/) | 2026-03 GA |

筆者の 6 項目を上記に mapping すると、**Schema validation / Cross-grader / Cost-recorded provenance** の 3 つは商用仕様と一致、残り (Cryptographic anchoring / Identity fingerprint / Schema-encoded prose) は商用仕様より一段強い実装で、これは §1 の relax mode bypass 罠を塞ぐために独自に必要だったものです。

### 6.1 ハーネス側の現在地 (記事執筆後の継続改善)

本記事の主題である 6 項目 (R3-R4) は実装済みですが、その後もハーネス側の改善は継続しています。記事執筆時点 (2026-04-29) で確認できる状態:

| 対策レイヤー | 現状 | 補足 |
|---|---|---|
| Schema validation | 実装済 | — |
| Cross-grader separation | 実装済 | identity fingerprint と組合せ |
| Cryptographic anchoring (sha256 chain) | 実装済 | ただし外部 anchor との組合せが前提 (§2 末尾) |
| Identity fingerprint comparison | 実装済 | strict mode + relax mode 警告として継続 |
| Cost-recorded provenance | 実装済 | rater=codex 強制 + 採点コスト記録 |
| Schema-encoded prose obligations | 実装済 | clarify session record / 第三者 ack / visual anchor 等を field 化 |
| Deployed-skill drift detection | 実装済 (追加層) | 配布版と本体の sha256 比較 |
| Multi-axis tier resolver | 実装済 (追加層) | タスク種別ごとに gate ON/OFF |
| Aesthetic regression defense | 実装済 (追加層) | LLM のデフォルト収束抑止 |
| Wrapper CI evidence seal | 実装済 (追加層) | CI 側で gate 入力改ざん検知 |
| External immutable attestation | 部分実装 | 初期実装は入っているが、完全な append-only にするには外部サービス連携が必要 |
| Deterministic execution attestation | 部分実装 | replay-based の検証スクリプトのみ。完全な決定性証明は未対応 |

最新の実装状態は付録 B のリポジトリを参照してください。本記事の最低限ライン 6 項目は安定しており、これを超える追加層は「ある方が望ましいが、6 項目で穴は塞げる」という位置づけです。

## 7. まとめ

複数ベンダーが provenance/trace ベースに同方向で動いている現時点で、自作 AI 監査ハーネスの設計判断はかなり明確になっています:

- AI が「レビューした」と返してきても、それを監査証跡としては扱えない
- 必要なのは結果値ではなく、**provenance (実行証跡)** を gate に要求すること
- 公式仕様 (Anthropic skill-creator の `evidence` field、OpenAI の Trace grading、Inspect AI の transcript) に追従するのが最短経路
- strict mode を作っただけでは不十分で、**relax mode 経由の bypass 経路**を機械検証で塞ぐ必要がある
- sha256 chain は単独では弱く、外部 anchor (CI / 公証 / TEE) と組み合わせて意味を持つ

商用 baseline に追従しつつ、relax mode 罠も塞いだ worked example として、本記事の実装が誰かの参考になれば幸いです。

## 用語ミニ表

| 用語 | 本記事での意味 |
|---|---|
| Provenance | レビュー/採点が実際に走った証跡 (run directory、transcript、evidence field 等) |
| run_dir | レビュー/採点が、1 回の実行ごとに作るディレクトリ |
| evidence field | 採点結果に「なぜそう判定したか」を明示する欄 |
| scalar gate | `verdict` `score` 等の値だけで通過判定するゲート設計 |
| provenance gate | run_dir / transcript / evidence の存在を必須化したゲート設計 |
| strict mode | gate の制約を最大限効かせる動作モード |
| relax mode | 既存運用との互換のため、制約の一部を緩めた動作モード |
| Schema fillability | 値を埋めるだけで通過可能な状態 (実行を伴わない) |

## 付録 A: Self-audit checklist

自分のハーネスで監査偽装が起きないか、5 分で確認できます:

- [ ] レビュー結果 (`verdict: GO`) を、それ単独で gate 通過の根拠にしていないか
- [ ] レビュー実行のたびに、ディレクトリ単位で run_dir / rubric / score / pass logs / transcript が残っているか
- [ ] レビューを行ったプロセス/モデルが実装側と異なることを、機械的に検証しているか
- [ ] 採点コスト (token / API call / wall-clock) が記録され、後から「実際に採点が走ったか」grep できるか
- [ ] skill 文書に書かれた「must / required」の文が、policy/schema の field に対応しているか
- [ ] `reviewer: self` が gate 通過に使われていないか (使われていたら downgrade されているか)
- [ ] **relax mode を作っているなら、relax された axis 全部が `relax_acknowledgment[]` 等の field に明示記録されているか** (§1 罠の対策)

## 付録 B: 検証用ハーネス

この記事で使った provenance gate の最小再現ハーネスを GitHub に置いています。最小再現コマンド:

```bash
git clone https://github.com/sho-ikeda-ai/god-provenance-gate --depth 1
cd god-provenance-gate
npm install
npm test                # 期待: provenance ファイル不在で gate が NOT_READY を返す
node src/cli.js examples/missing-provenance.json
node src/cli.js examples/self-attested-review.json
node src/cli.js examples/valid-provenance.json
```

**対象 tag**: `v0.1.0`

特にコメントが嬉しい軸:

- 同じ relax mode bypass 罠を別ハーネスでぶつかった経験
- 業界ごとに必要な provenance 水準の違い
- insider threat (実装担当 LLM が grader 起動権限も持つ構成) を塞ぐ設計案

## 参考リンク

### 業界の動向

- [NIST/CAISI: Cheating on AI Agent Evaluations](https://www.nist.gov/blogs/caisi-research-blog/cheating-ai-agent-evaluations)
- [NIST/CAISI: Practices for detecting and preventing evaluation cheating](https://www.nist.gov/caisi/cheating-ai-agent-evaluations/4-practices-detecting-and-preventing-evaluation-cheating)
- [NIST/CAISI: Using transcript review tools to find cheating at scale](https://www.nist.gov/caisi/cheating-ai-agent-evaluations/3-using-transcript-review-tools-find-cheating-scale)
- [Anthropic skills/skill-creator (`grading.json` evidence field)](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)
- [Anthropic: Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [OpenAI: Trace grading](https://developers.openai.com/api/docs/guides/trace-grading)
- [OpenAI: Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals)
- [UK AISI Inspect AI](https://inspect.aisi.org.uk/)
- [Inspect AI on GitHub](https://github.com/UKGovernmentBEIS/inspect_ai)
- [Langfuse: LLM-as-a-Judge Execution Tracing (2025-10)](https://langfuse.com/changelog/2025-10-16-llm-as-a-judge-execution-tracing)
- [GitHub Copilot Code Review on agentic architecture (2026-03-05)](https://github.blog/changelog/2026-03-05-copilot-code-review-now-runs-on-an-agentic-architecture/)
- [GitHub Docs: About Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)

### 関連研究

- [Zheng et al. (2023): Judging LLM-as-a-Judge with MT-Bench (arXiv)](https://arxiv.org/abs/2306.05685)
- [METR](https://metr.org/) (frontier model の reward hacking 報告)
- [Anthropic Research](https://www.anthropic.com/research) (specification gaming / reward tampering 系)
- [OpenAI: Why Language Models Hallucinate](https://openai.com/index/why-language-models-hallucinate/)
- [OpenAI Research](https://openai.com/research/) (scheming / deception 系)
