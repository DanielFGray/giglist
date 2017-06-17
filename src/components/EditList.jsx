// @flow
import React, { Component } from 'react'
import {
  Button,
  Card,
  Form,
  TextArea,
} from 'semantic-ui-react'
import request from 'superagent'

class Editor extends Component {
  props: {
    match: {
      params: {
        id: string,
      },
    },
  }

  state = {
    data: {
      list: '',
    },
  }

  componentDidMount() {
    fetch(`/api/v1/list/${this.props.match.params.id}`)
      .then(response => response.json())
      .then(data => data.body)
      .then(data => this.setState({ data }))
  }

  save = (e: SyntheticEvent) => {
    e.preventDefault()
    const list = document.getElementById('markdown_textarea').value
    request.put(`/api/v1/list/${this.props.match.params.id}`) // FIXME: use fetch()
      .send(`list=${list}`)
      .then(() => window.location.href = `/#/view/${this.props.match.params.id}`) // eslint-disable-line
  }

  delete = (e: SyntheticEvent) => {
    e.preventDefault()
    fetch(`/api/v1/list/${this.props.match.params.id}`, { method: 'DELETE' })
      .then(() => window.location.href = '/#/') // eslint-disable-line no-return-assign
  }

  render() {
    return (
      <Form action={`/api/v1/list/${this.props.match.params.id}`} method="PUT" onSubmit={this.save}>
        <div style={{ padding: '10px' }}>
          <Card fluid>
            <Card.Header>
              <h1 style={{ padding: '3px 15px' }}>Edit</h1>
            </Card.Header>
            <Card.Content>
              {(this.props.match.params.id === 'new' || this.state.data.list) && <TextThing input={this.state.data.list} /> }
            </Card.Content>
            <Card.Content extra>
              {[
                { content: 'Save', color: 'green', icon: 'write', type: 'submit' },
                { content: 'Reset', color: 'yellow', icon: 'repeat', type: 'reset' },
                { content: 'Delete', color: 'red', icon: 'remove', onClick: this.delete },
              ].map(e => <Button key={e.content} size="tiny" {...e} />)}
            </Card.Content>
          </Card>
        </div>
      </Form>
    )
  }
}

class TextThing extends Component { // eslint-disable-line react/no-multi-comp
  props: {
    input: string,
  }

  state = {
    input: this.props.input,
  }

  update = (e: SyntheticInputEvent) => this.setState({ input: e.target.value })

  render() {
    return (
      <TextArea
        id="markdown_textarea"
        autoHeight
        autoFocus
        placeholder="Loading..."
        value={this.state.input}
        onChange={this.update}
      />
    )
  }
}

export default Editor
