# MiniEdit 示例 —— 用原版 python.mac 的规则着色
from dataclasses import dataclass, field
from typing import Iterable

MAX_DEPTH = 12


@dataclass
class Node:
    name: str
    children: list = field(default_factory=list)
    depth: int = 0

    def walk(self) -> Iterable["Node"]:
        """深度优先遍历，超过 MAX_DEPTH 就不再下钻。"""
        yield self
        if self.depth >= MAX_DEPTH:
            return
        for child in self.children:
            child.depth = self.depth + 1
            yield from child.walk()


def build(tree: dict, depth: int = 0) -> Node:
    node = Node(name=tree.get("name", "<unnamed>"), depth=depth)
    for raw in tree.get("children", []):
        node.children.append(build(raw, depth + 1))
    return node


if __name__ == "__main__":
    sample = {
        "name": "root",
        "children": [
            {"name": "alpha", "children": [{"name": "alpha-1"}]},
            {"name": "beta", "children": []},
        ],
    }

    total = 0
    for item in build(sample).walk():
        total += 1
        print(f"{'  ' * item.depth}{item.name} (depth={item.depth})")

    print(f"\n共 {total} 个节点，上限 {MAX_DEPTH} 层")
