import React, { Component, PropTypes } from 'react'
import {
  Button,
  Card,
  Form,
  TextArea,
} from 'semantic-ui-react'

class Editor extends Component {
  static propTypes = {
    match: PropTypes.shape({
      params: PropTypes.shape({
        id: PropTypes.string.isRequired,
      }).isRequired,
    }).isRequired,
  }

  constructor(props) {
    super(props)
    this.state = {
      data: {
        list: '',
      },
    }
  }

  componentDidMount() {
    fetch(`/api/v1/list/${this.props.match.params.id}`)
      .then(response => response.json())
      .then(data => data.body)
      .then(data => {
        this.setState({ data })
      })
  }

  submit = e => {
    e.preventDefault()
    console.log(e)
  }

  render() {
    console.log(this.state.data)
    return (
      <Form action={`/api/v1/save/${this.props.match.params.id}`} method="POST" onSubmit={this.submit}>
        <div style={{ padding: '10px' }}>
          <Card fluid>
            <Card.Header>
              <h1 style={{ padding: '3px 15px' }}>Edit</h1>
            </Card.Header>
            <Card.Content>
              {this.state.data.list && <TextThing input={this.state.data.list} /> }
            </Card.Content>
            <Card.Content extra>
              {[
                { content: 'Save', type: 'submit', color: 'blue', icon: 'write' },
                { content: 'Reset', type: 'reset', color: 'yellow', icon: 'repeat' },
                { content: 'Delete', type: 'submit', color: 'red', icon: 'remove' },
              ].map(e =>
                <Button key={e.content} size="tiny" {...e} />
              )}
            </Card.Content>
          </Card>
        </div>
      </Form>
    )
  }
}

class TextThing extends Component { // eslint-disable-line react/no-multi-comp
  static propTypes = {
    input: PropTypes.string.isRequired,
  }

  constructor(props) {
    super(props)
    this.state = {
      input: this.props.input,
    }
  }

  update = e => {
    this.setState({ input: e.target.value })
  }

  render() {
    console.log(this.state)
    return (
      <TextArea
        name="markdown"
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
