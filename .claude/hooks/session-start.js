#!/usr/bin/env node

/**
 * Session Start Hook for Finance Agent
 * Shows project info on session start
 */

const path = require('path');
const fs = require('fs');

function getProjectInfo() {
  const projectRoot = process.cwd();

  // Check if this is the finagent project
  const claudeMdPath = path.join(projectRoot, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    return null;
  }

  return {
    name: 'Finance Agent',
    path: projectRoot,
    docs: {
      prd: path.join(projectRoot, 'docs', 'PRD.md'),
      longbridgeSetup: path.join(projectRoot, 'docs', 'longbridge-skill-setup.md'),
      apiReference: path.join(projectRoot, 'docs', 'api-reference.md'),
      architecture: path.join(projectRoot, 'docs', 'architecture.md'),
    },
    packages: {
      core: path.join(projectRoot, 'packages', 'core'),
      shared: path.join(projectRoot, 'packages', 'shared'),
      ui: path.join(projectRoot, 'packages', 'ui'),
      piExtension: path.join(projectRoot, 'packages', 'pi-extension'),
      longbridgeTools: path.join(projectRoot, 'packages', 'longbridge-tools'),
    },
    apps: {
      electron: path.join(projectRoot, 'apps', 'electron'),
    },
  };
}

function displayProjectInfo() {
  const info = getProjectInfo();
  if (!info) {
    return;
  }

  console.log('\n📊 Finance Agent Project');
  console.log('=' .repeat(50));
  console.log(`📁 Location: ${info.path}`);
  console.log('\n📚 Documentation:');
  console.log('   • PRD: docs/PRD.md');
  console.log('   • LongBridge Setup: docs/longbridge-skill-setup.md');
  console.log('   • API Reference: docs/api-reference.md');
  console.log('   • Architecture: docs/architecture.md');
  console.log('\n📦 Packages:');
  console.log('   • core - Type definitions');
  console.log('   • shared - Business logic');
  console.log('   • ui - React components');
  console.log('   • pi-extension - Pi Agent tools');
  console.log('   • longbridge-tools - CLI wrapper');
  console.log('\n🖥️  Apps:');
  console.log('   • electron - Desktop app');
  console.log('\n🔧 Required Skills:');
  console.log('   • pi-coding-agent - Pi Agent development');
  console.log('   • craft-agent-template - Electron architecture');
  console.log('   • longbridge-skill - LongBridge integration');
  console.log('\n💡 Quick Commands:');
  console.log('   • bun run dev - Start development');
  console.log('   • bun run build - Build project');
  console.log('=' .repeat(50) + '\n');
}

displayProjectInfo();
